import {
    LooseProjectNameRequirement,
    LooseProjectNameRequirementWithLocation,
    parsePipRequirementsLineLoosely,
    Requirement,
} from 'pip-requirements-js'
import { parseTOML, traverseNodes } from 'toml-eslint-parser'
import { TOMLArray, TOMLKeyValue, TOMLNode, TOMLTable } from 'toml-eslint-parser/lib/ast'
import { Visitor } from 'toml-eslint-parser/lib/traverse'
import { TextDocumentLike, RawRange, RequirementFound } from './types'

class PyprojectTOMLVisitor implements Visitor<TOMLNode> {
    /** Current table path. */
    private pathStack: (string | number)[] = []

    public dependencies: [RequirementFound, RawRange][] = []

    public enterNode(node: TOMLNode) {
        if (node.type === 'TOMLTable') {
            this.pathStack = node.resolvedKey.slice()
            this.potentiallyRegisterPoetryDependency(node)
            this.potentiallyRegisterPixiDependency(node)
        } else if (node.type === 'TOMLKeyValue') {
            this.pathStack.push(
                ...node.key.keys.map((key) => ('name' in key ? key.name : 'value' in key ? key.value : ''))
            )
            this.potentiallyRegisterPoetryDependency(node)
            this.potentiallyRegisterPixiDependency(node)
        } else if (node.type === 'TOMLArray') {
            this.potentiallyRegisterPep631Dependency(node)
            this.potentiallyRegisterPep735Dependency(node)
            this.potentiallyRegisterUvDependency(node)
            this.potentiallyRegisterBuildSystemDependency(node)
        }
    }

    public leaveNode(node: TOMLNode) {
        if (node.type === 'TOMLTable') {
            this.pathStack.length = 0
        } else if (node.type === 'TOMLKeyValue') {
            this.pathStack.pop()
        }
    }

    private potentiallyRegisterPoetryDependency(node: TOMLTable | TOMLKeyValue): void {
        if (this.pathStack[0] === 'tool' && this.pathStack[1] === 'poetry') {
            let projectName: string | undefined
            if (
                ['dependencies', 'dev-dependencies'].includes(this.pathStack[2] as string) &&
                this.pathStack.length === 4 &&
                typeof this.pathStack[3] === 'string'
            ) {
                // Basic dependencies and legacy dev dependencies
                projectName = this.pathStack[3]
            } else if (
                this.pathStack[2] === 'group' &&
                this.pathStack[4] === 'dependencies' &&
                this.pathStack.length === 6 &&
                typeof this.pathStack[5] === 'string'
            ) {
                // Dependency group
                projectName = this.pathStack[5]
            }
            if (projectName) {
                this.dependencies.push([
                    projectName,
                    [node.loc.start.line - 1, node.loc.start.column, node.loc.end.line - 1, node.loc.end.column],
                ])
            }
        }
    }

    private potentiallyRegisterPixiDependency(node: TOMLTable | TOMLKeyValue): void {
        if (
            this.pathStack[0] === 'tool' &&
            this.pathStack[1] === 'pixi' &&
            this.pathStack[2] === 'pypi-dependencies' &&
            this.pathStack[3] &&
            typeof this.pathStack[3] === 'string'
        ) {
            this.dependencies.push([
                this.pathStack[3],
                [node.loc.start.line - 1, node.loc.start.column, node.loc.end.line - 1, node.loc.end.column],
            ])
        }
    }

    private potentiallyRegisterPep631Dependency(node: TOMLArray): void {
        const isUnderRequiredDependencies =
            this.pathStack.length === 2 && this.pathStack[0] === 'project' && this.pathStack[1] === 'dependencies'
        const isUnderOptionalDependencies =
            this.pathStack.length === 3 &&
            this.pathStack[0] === 'project' &&
            this.pathStack[1] === 'optional-dependencies' // pathStack[2] is arbitrary here - it's the name of the extra
        if (!isUnderRequiredDependencies && !isUnderOptionalDependencies) {
            return
        }
        this.registerElementsAsDependencies(node.elements)
    }

    private potentiallyRegisterUvDependency(node: TOMLArray): void {
        const isUnderConstraintDependencies =
            this.pathStack.length === 3 &&
            this.pathStack[0] === 'tool' &&
            this.pathStack[1] === 'uv' &&
            this.pathStack[2] === 'constraint-dependencies'
        const isUnderDevDependencies =
            this.pathStack.length === 3 &&
            this.pathStack[0] === 'tool' &&
            this.pathStack[1] === 'uv' &&
            this.pathStack[2] === 'dev-dependencies'
        const isUnderOverrideDependencies =
            this.pathStack.length === 3 &&
            this.pathStack[0] === 'tool' &&
            this.pathStack[1] === 'uv' &&
            this.pathStack[2] === 'override-dependencies'

        if (!isUnderConstraintDependencies && !isUnderDevDependencies && !isUnderOverrideDependencies) {
            return
        }
        this.registerElementsAsDependencies(node.elements)
    }

    private potentiallyRegisterPep735Dependency(node: TOMLArray): void {
        const isUnderDependencyGroups = this.pathStack.length === 2 && this.pathStack[0] === 'dependency-groups' // pathStack[1] is arbitrary here - it's the name of the group
        if (!isUnderDependencyGroups) {
            return
        }
        this.registerElementsAsDependencies(node.elements)
    }

    private potentiallyRegisterBuildSystemDependency(node: TOMLArray): void {
        const isUnderBuildSystem =
            this.pathStack.length === 2 && this.pathStack[0] === 'build-system' && this.pathStack[1] === 'requires'
        if (!isUnderBuildSystem) {
            return
        }
        this.registerElementsAsDependencies(node.elements)
    }

    private registerElementsAsDependencies(elements: TOMLNode[]): void {
        for (const item of elements) {
            if (item.type !== 'TOMLValue' || typeof item.value !== 'string' || !item.value) {
                continue // Only non-empty strings can be dependency specifiers
            }
            let requirement: LooseProjectNameRequirementWithLocation | null
            try {
                requirement = parsePipRequirementsLineLoosely(item.value, { includeLocations: true })
            } catch {
                continue
            }
            if (requirement?.data.type !== 'ProjectName') continue

            // Adjust location indices to account for the opening quote in TOML string
            // TOML strings are quoted, so content starts at item.loc.start.column + 1
            const startOfRequirement = item.loc.start.column + 1
            const endOfRequirement = item.loc.end.column - 1
            this.adjustRequirementLocations(requirement, startOfRequirement)

            this.dependencies.push([
                requirement,
                [item.loc.start.line - 1, startOfRequirement, item.loc.end.line - 1, endOfRequirement],
            ])
        }
    }

    /** Adjust the requirement locations to account for the beginning quote " */
    private adjustRequirementLocations(requirement: LooseProjectNameRequirementWithLocation, offset: number): void {
        requirement.data.name.location.startIdx += offset
        requirement.data.name.location.endIdx += offset
        if (requirement.data.versionSpec) {
            for (const spec of requirement.data.versionSpec) {
                spec.location.startIdx += offset
                spec.location.endIdx += offset
                spec.data.operator.location.startIdx += offset
                spec.data.operator.location.endIdx += offset
                if (spec.data.version) {
                    spec.data.version.location.startIdx += offset
                    spec.data.version.location.endIdx += offset
                }
            }
        }
    }
}

export function extractRequirementsFromPyprojectToml(document: TextDocumentLike): [RequirementFound, RawRange][] {
    const visitor = new PyprojectTOMLVisitor()
    traverseNodes(parseTOML(document.getText()), visitor)
    return visitor.dependencies
}

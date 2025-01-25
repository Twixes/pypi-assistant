import { LooseProjectNameRequirement, parsePipRequirementsLineLoosely, Requirement } from 'pip-requirements-js'
import { parseTOML, traverseNodes } from 'toml-eslint-parser'
import { TOMLArray, TOMLKeyValue, TOMLNode, TOMLTable } from 'toml-eslint-parser/lib/ast'
import { Visitor } from 'toml-eslint-parser/lib/traverse'
import { TextDocumentLike, RawRange } from './types'

class PyprojectTOMLVisitor implements Visitor<TOMLNode> {
    /** Current table path. */
    private pathStack: (string | number)[] = []

    public dependencies: [LooseProjectNameRequirement, RawRange][] = []

    public enterNode(node: TOMLNode) {
        if (node.type === 'TOMLTable') {
            this.pathStack = node.resolvedKey.slice()
            this.potentiallyRegisterPoetryDependency(node)
        } else if (node.type === 'TOMLKeyValue') {
            this.pathStack.push(
                ...node.key.keys.map((key) => ('name' in key ? key.name : 'value' in key ? key.value : ''))
            )
            this.potentiallyRegisterPoetryDependency(node)
        } else if (node.type === 'TOMLArray') {
            this.potentiallyRegisterPep631Dependency(node)
            this.potentiallyRegisterUVDependency(node)
            this.potentiallyRegisterPep735Dependency(node)
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
                    {
                        name: projectName,
                        type: 'ProjectName',
                    },
                    [node.loc.start.line - 1, node.loc.start.column, node.loc.end.line - 1, node.loc.end.column],
                ])
            }
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

    private potentiallyRegisterUVDependency(node: TOMLArray): void {
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

    private registerElementsAsDependencies(elements: TOMLNode[]): void {
        for (const item of elements) {
            if (item.type !== 'TOMLValue' || typeof item.value !== 'string' || !item.value) {
                continue // Only non-empty strings can be dependency specifiers
            }
            let requirement: Requirement | null
            try {
                requirement = parsePipRequirementsLineLoosely(item.value)
            } catch {
                continue
            }
            if (requirement?.type !== 'ProjectName') continue
            this.dependencies.push([
                requirement,
                [item.loc.start.line - 1, item.loc.start.column, item.loc.end.line - 1, item.loc.end.column],
            ])
        }
    }
}

export function extractRequirementsFromPyprojectToml(
    document: TextDocumentLike
): [LooseProjectNameRequirement, RawRange][] {
    const visitor = new PyprojectTOMLVisitor()
    traverseNodes(parseTOML(document.getText()), visitor)
    return visitor.dependencies
}

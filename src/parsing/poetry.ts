import { LooseProjectNameRequirement } from 'pip-requirements-js'
import { parseTOML, traverseNodes } from 'toml-eslint-parser'
import { SourceLocation, TOMLKeyValue, TOMLNode, TOMLTable } from 'toml-eslint-parser/lib/ast'
import { Visitor } from 'toml-eslint-parser/lib/traverse'
import { TextDocumentLike, RawRange } from './types'

class PoetryVisitor implements Visitor<TOMLNode> {
    /** Current table path. */
    private stack: (string | number)[] = []

    public dependencies: [LooseProjectNameRequirement, RawRange][] = []

    public enterNode(node: TOMLNode) {
        if (node.type === 'TOMLTable') {
            this.stack = node.resolvedKey.slice()
            this.checkForDependencyAtStackTop(node)
        } else if (node.type === 'TOMLKeyValue') {
            this.stack.push(...node.key.keys.map((key) => ('name' in key ? key.name : 'value' in key ? key.value : '')))
            this.checkForDependencyAtStackTop(node)
        }
    }

    public leaveNode(node: TOMLNode) {
        if (node.type === 'TOMLTable') {
            this.stack.length = 0
        } else if (node.type === 'TOMLKeyValue') {
            this.stack.pop()
        }
    }

    private checkForDependencyAtStackTop(node: TOMLTable | TOMLKeyValue): void {
        if (this.stack[0] === 'tool' && this.stack[1] === 'poetry') {
            let projectName: string | undefined
            if (
                ['dependencies', 'dev-dependencies'].includes(this.stack[2] as string) &&
                this.stack.length === 4 &&
                typeof this.stack[3] === 'string'
            ) {
                // Basic dependencies and legacy dev dependencies
                projectName = this.stack[3]
            } else if (
                this.stack[2] === 'group' &&
                this.stack[4] === 'dependencies' &&
                this.stack.length === 6 &&
                typeof this.stack[5] === 'string'
            ) {
                // Dependency group
                projectName = this.stack[5]
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
}

export function extractRequirementsFromPyprojectToml(
    document: TextDocumentLike
): [LooseProjectNameRequirement, RawRange][] {
    const visitor = new PoetryVisitor()
    traverseNodes(parseTOML(document.getText()), visitor)
    return visitor.dependencies
}

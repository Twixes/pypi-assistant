import { LooseProjectNameRequirement } from 'pip-requirements-js'
import vscode from 'vscode'
import { LRUCache } from 'lru-cache'
import { extractRequirementsFromPipRequirements } from './requirements'
import { extractRequirementsFromPyprojectToml } from './pyproject'
import path from 'node:path'
import { RawRange } from './types'

const outputChannel = vscode.window.createOutputChannel('Python PyPI Assistant')

type VersionedFileKey = `${string}::${number}`

export class RequirementsParser {
    cache: Map<VersionedFileKey, [LooseProjectNameRequirement, RawRange][]> = new LRUCache({ max: 30 })

    public getAll(document: vscode.TextDocument): [LooseProjectNameRequirement, vscode.Range][] {
        const cacheKey: VersionedFileKey = `${document.uri.toString(true)}::${document.version}`
        let requirements: [LooseProjectNameRequirement, RawRange][]
        if (this.cache.has(cacheKey)) {
            requirements = this.cache.get(cacheKey)!
        } else {
            try {
                switch (RequirementsParser.determineFileType(document)) {
                    case 'pip-requirements':
                        requirements = extractRequirementsFromPipRequirements(document)
                        break
                    case 'pyproject':
                        requirements = extractRequirementsFromPyprojectToml(document)
                        break
                    default:
                        return []
                }
            } catch (e) {
                outputChannel.appendLine(
                    `Error parsing requirements in ${document.uri.toString(true)}::${document.version}: ${e}`
                )
                return []
            }
            outputChannel.appendLine(
                `Parsed requirements in ${document.uri.toString(true)}::${document.version}:\n${requirements
                    .map(
                        ([requirement, range]) =>
                            `${requirement.name} @ ${range[0]}#${range[1]} - ${range[2]}#${range[3]}`
                    )
                    .join('\n')}`
            )
            this.cache.set(cacheKey, requirements)
        }
        return requirements
            .filter(([requirement]) => requirement.name !== 'python')
            .map(([requirement, range]) => [requirement, new vscode.Range(...range)])
    }

    public getAtPosition(
        document: vscode.TextDocument,
        position: vscode.Position
    ): [LooseProjectNameRequirement, vscode.Range] | null {
        const requirements = this.getAll(document)
        for (const [requirement, range] of requirements) {
            if (range.contains(position)) {
                return [requirement, range]
            }
        }
        return null
    }

    public clear(): void {
        this.cache.clear()
    }

    private static determineFileType(document: vscode.TextDocument): 'pyproject' | 'pip-requirements' | null {
        if (document.languageId === 'pip-requirements') {
            return 'pip-requirements'
        } else if (document.languageId === 'toml') {
            const parsedPath = path.parse(document.fileName)
            if (parsedPath.ext === '.toml' && parsedPath.name === 'pyproject') {
                return 'pyproject'
            }
        }
        return null
    }
}

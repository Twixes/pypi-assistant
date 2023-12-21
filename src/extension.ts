import dayjs from 'dayjs'
import fetch, { FormData } from 'node-fetch'
import { ProjectNameRequirement, Requirement, parsePipRequirementsLineLoosely } from 'pip-requirements-js'
import { parse } from 'toml'
import vscode from 'vscode'
import wretch from 'wretch'
import { WretchError } from 'wretch/resolver'
import { createHash } from 'node:crypto'

wretch.polyfills({
    fetch,
    FormData,
})
const outputChannel = vscode.window.createOutputChannel('PyPI Assistant')

/* Partial model of the package response returned by PyPI. */
export interface PackageMetadata {
    info: {
        name: string
        summary: string
        home_page: string
        author: string
        author_email: string
        package_url: string
        license: string
        version: string
        release_url: string
    }
    releases: Record<string, { upload_time: string }[]>
}

const metadataCache: Map<string, () => Promise<PackageMetadata>> = new Map()

function linkify(text: string, link?: string): string {
    return link ? `[${text}](${link})` : text
}

function parseDependenciesGroup(dependenciesGroup: Record<string, string>): ProjectNameRequirement[] {
    return Object.keys(dependenciesGroup)
        .filter((dependency) => dependency.toLowerCase() !== 'python')
        .map((dependency) => ({
            name: dependency,
            type: 'ProjectName',
        }))
}

const parsedPyProjectToml = new Map<string, ProjectNameRequirement[]>()

function getPyProjectDependencies(fileContents: string): ProjectNameRequirement[] {
    const hash = createHash('sha256').update(fileContents).digest('hex')
    const cachedDependencies = parsedPyProjectToml.get(hash)

    if (cachedDependencies) return cachedDependencies

    const parsedContents = parse(fileContents)
    const dependencies: ProjectNameRequirement[] = []

    const productionDependencies = parsedContents?.tool?.poetry?.dependencies || {}
    const parsedProductionDependencies = parseDependenciesGroup(productionDependencies)

    dependencies.push(...parsedProductionDependencies)

    const group = parsedContents?.tool?.poetry?.group

    if (group) {
        outputChannel.appendLine(`Found group dependencies: ${JSON.stringify(group)}`)
        Object.keys(group).forEach((groupName) => {
            outputChannel.appendLine(`Processing dependencies group: ${groupName}`)
            const groupDependencies = parseDependenciesGroup(group[groupName]?.dependencies || {})
            outputChannel.appendLine(`Parsed dependencies group: ${JSON.stringify(groupDependencies)}`)
            dependencies.push(...groupDependencies)
        })
    }

    parsedPyProjectToml.set(hash, dependencies)
    return dependencies
}

/** Fetching package metadata with a caching layer. */
async function fetchPackageMetadata(requirement: ProjectNameRequirement): Promise<PackageMetadata> {
    if (!metadataCache.has(requirement.name)) {
        metadataCache.set(requirement.name, async () => {
            let metadata: PackageMetadata
            try {
                metadata = await wretch(`https://pypi.org/pypi/${requirement.name}/json`).get().json()
            } catch (e) {
                if (e instanceof WretchError) {
                    switch (e.status) {
                        case 404:
                            throw new Error(`Package not found in PyPI`)
                        default:
                            throw new Error(`Unexpected ${e.status} response from PyPI: ${e.json}`)
                    }
                }
                metadataCache.delete(requirement.name)
                throw new Error('Cannot connect to PyPI')
            }
            return metadata
        })
    }
    return await metadataCache.get(requirement.name)!()
}

let lastLine = -1
let lastHover: vscode.Hover | null = null
let lastLineText = ''

class PyPIHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        let lineText = document.lineAt(position.line).text
        if (lastLine === position.line && lineText === lastLineText) {
            return lastHover
        }

        const isPyProjectToml =
            document.languageId === 'toml' && document.fileName.toLowerCase().endsWith('pyproject.toml')

        if (isPyProjectToml) {
            const dependencies = getPyProjectDependencies(document.getText())
            // Workaround for extracting just the package name from the line
            lineText = lineText.split('=')[0].trim()
            const requirement = dependencies.find((dependency) => dependency.name === lineText)
            if (requirement === undefined) return null
        }
        outputChannel.appendLine(`Parsing line ${lineText}`)

        const requirement = parsePipRequirementsLineLoosely(lineText)
        outputChannel.appendLine(`Parsed requirement: ${JSON.stringify(requirement)} from ${lineText}`)
        if (requirement?.type !== 'ProjectName') return null
        const metadata = await fetchPackageMetadata(requirement)
        if (metadata === null) return null
        // Cache the last hover to avoid fetching the same metadata twice
        lastLineText = lineText
        lastLine = position.line
        lastHover = new vscode.Hover(this.formatPackageMetadata(metadata))
        return lastHover
    }

    formatPackageMetadata(metadata: PackageMetadata): string {
        const { info, releases } = metadata
        const summarySubPart: string = info.summary ? ` – ${linkify(info.summary, info.home_page)}` : ''
        const metadataPresentation: string[] = [`**${linkify(info.name, info.package_url)}${summarySubPart}**`]
        const emailSubpart: string = info.author_email ? ` (${info.author_email})` : ''
        const authorSubpart: string | null =
            info.author && info.author_email ? `By ${info.author}${emailSubpart}.` : null
        const licenseSubpart: string | null = info.license ? `License: ${info.license}.` : null
        if (authorSubpart || licenseSubpart)
            metadataPresentation.push([authorSubpart, licenseSubpart].filter(Boolean).join(' '))
        metadataPresentation.push(
            `Latest version: ${linkify(info.version, info.release_url)} (released on ${dayjs(
                releases[info.version][0].upload_time
            ).format('D MMMM YYYY')}).`
        )
        return metadataPresentation.join('\n\n')
    }
}

class PyPICodeLens extends vscode.CodeLens {
    requirement: ProjectNameRequirement

    constructor(range: vscode.Range, requirement: ProjectNameRequirement) {
        super(range)
        this.requirement = requirement
    }
}

class PyPICodeLensProvider implements vscode.CodeLensProvider<PyPICodeLens> {
    provideCodeLenses(document: vscode.TextDocument): PyPICodeLens[] {
        const codeLensEnabled = vscode.workspace.getConfiguration('pypiAssistant').get('codeLens')
        const codeLenses: PyPICodeLens[] = []

        if (!codeLensEnabled) {
            return codeLenses
        }

        if (document.languageId === 'toml' && document.fileName.toLowerCase().endsWith('pyproject.toml')) {
            const dependencies = getPyProjectDependencies(document.getText())

            for (let line = 0; line < document.lineCount; line++) {
                const lineText = document.lineAt(line).text
                const requirement = dependencies.find((dependency) => {
                    return lineText.startsWith(`${dependency.name} = `)
                })

                if (requirement?.type !== 'ProjectName') continue
                codeLenses.push(new PyPICodeLens(new vscode.Range(line, 0, line, 0), requirement))
            }
            return codeLenses
        }

        for (let line = 0; line < document.lineCount; line++) {
            let requirement: Requirement | null
            try {
                requirement = parsePipRequirementsLineLoosely(document.lineAt(line).text)
            } catch {
                continue
            }
            if (requirement?.type !== 'ProjectName') continue
            codeLenses.push(new PyPICodeLens(new vscode.Range(line, 0, line, 0), requirement))
        }
        return codeLenses
    }

    async resolveCodeLens(codeLens: PyPICodeLens): Promise<PyPICodeLens> {
        let title: string
        try {
            const metadata = await fetchPackageMetadata(codeLens.requirement)
            title = this.formatPackageMetadata(metadata)
        } catch (e) {
            title = (e as Error).message
        }
        codeLens.command = {
            command: '',
            title,
        }
        return codeLens
    }

    formatPackageMetadata(metadata: PackageMetadata): string {
        const { info } = metadata
        return `Latest version: ${info.version}`
    }
}

export function activate(_: vscode.ExtensionContext) {
    const hoverProvider = new PyPIHoverProvider()
    const codeLensProvider = new PyPICodeLensProvider()
    vscode.languages.registerCodeLensProvider('pip-requirements', codeLensProvider)
    vscode.languages.registerHoverProvider('pip-requirements', hoverProvider)
    vscode.languages.registerCodeLensProvider('toml', codeLensProvider)
    vscode.languages.registerHoverProvider('toml', hoverProvider)
}

export function deactivate() {
    metadataCache.clear()
}

import vscode from 'vscode'
import fetch, { Response } from 'node-fetch'
import dayjs from 'dayjs'
import { extractPackageRequirement, PackageRequirement } from './parsing'

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

let metadataCache: Map<string, PackageMetadata | null> = new Map()

function linkify(text: string, link?: string): string {
    return link ? `[${text}](${link})` : text
}

/** Fetching package metadata with a caching layer. */
async function fetchPackageMetadata(requirement: PackageRequirement): Promise<PackageMetadata | null> {
    if (metadataCache.has(requirement.id)) return metadataCache.get(requirement.id)!
    const response: Response = await fetch(`https://pypi.org/pypi/${requirement.id}/json`)
    let metadata: PackageMetadata | null
    switch (response.status) {
        case 200:
            metadata = await response.json()
            break
        case 404:
            metadata = null
            break
        default:
            throw new Error(`Unexpected response from PyPI: status ${response.status}`)
    }
    metadataCache.set(requirement.id, metadata)
    return metadata
}

class PyPIHoverProvider implements vscode.HoverProvider {
    async provideHover(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.Hover | null> {
        const requirement = extractPackageRequirement(document.lineAt(position.line).text)
        if (requirement === null) return null
        const metadata = await fetchPackageMetadata(requirement)
        if (metadata === null) return null
        return new vscode.Hover(this.formatPackageMetadata(metadata))
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
    requirement: PackageRequirement

    constructor(range: vscode.Range, requirement: PackageRequirement) {
        super(range)
        this.requirement = requirement
    }
}

function identifyCurrentVersion(constraints: [string, string][]) {
    return constraints?.[0]?.[1]
}

class PyPICodeLensProvider implements vscode.CodeLensProvider {
    provideCodeLenses(document: vscode.TextDocument): PyPICodeLens[] {
        const codeLenses: PyPICodeLens[] = []
        if (vscode.workspace.getConfiguration('pypiAssistant').get('codeLens')) {
            for (let line = 0; line < document.lineCount; line++) {
                const requirement: PackageRequirement | null = extractPackageRequirement(document.lineAt(line).text)
                if (!requirement) continue
                codeLenses.push(new PyPICodeLens(new vscode.Range(line, 0, line, 0), requirement))
            }
        }
        return codeLenses
    }

    async resolveCodeLens(codeLens: PyPICodeLens): Promise<vscode.CodeLens | null> {
        const metadata = await fetchPackageMetadata(codeLens.requirement)
        if (metadata === null) return new vscode.CodeLens(codeLens.range, { command: '', title: 'package not found' })

        const lineNumber = codeLens.range.start.line
        const versionClauseType = codeLens.requirement.constraints?.[0]?.[0]
        // Based on specified constraints, identify latest possible currentVersion

        const currentVersion = identifyCurrentVersion(codeLens.requirement.constraints)
        const latestVersion = metadata?.info?.version

        const hasCurrentVersion = currentVersion !== undefined
        const hasLatestVersion = latestVersion !== undefined
        const isLatestVersion = hasCurrentVersion && hasLatestVersion && currentVersion === latestVersion

        const id = codeLens.requirement.id

        /* Offer option to bump package only when package version is not latest */
        return new vscode.CodeLens(codeLens.range, {
            arguments: [lineNumber, currentVersion, latestVersion, versionClauseType, id],
            command: !isLatestVersion ? 'pypiAssistant.bumpPackageVersion' : '',
            title: this.formatPackageMetadata(metadata, isLatestVersion),
        })
    }

    formatPackageMetadata(metadata: PackageMetadata, isLatestVersion: boolean): string {
        const { info } = metadata

        return isLatestVersion ? 'latest' : `latest: ↑ ${info.version}`
    }
}

export function activate(context: vscode.ExtensionContext) {
    vscode.languages.registerCodeLensProvider('pip-requirements', new PyPICodeLensProvider())
    vscode.languages.registerHoverProvider('pip-requirements', new PyPIHoverProvider())

    const bumpPackageCommand = 'pypiAssistant.bumpPackageVersion'

    const bumpPackageCommandHandler = (
        lineNumber: number,
        currentVersion: string,
        latestVersion: string,
        versionClauseType: string,
        id: string
    ) => {
        const editor = vscode.window.activeTextEditor
        const document = editor?.document

        if (editor !== undefined && document !== undefined) {
            editor.edit((editBuilder) => {
                const line = document.lineAt(lineNumber)
                if (currentVersion !== latestVersion) {
                    let startIdx, endIdx
                    if (versionClauseType === undefined) {
                        startIdx = line.text.indexOf(id) + id.length
                        endIdx = startIdx
                    } else {
                        const firstIdxAfterversionClauseType =
                            line.text.indexOf(versionClauseType) + versionClauseType.length
                        startIdx =
                            firstIdxAfterversionClauseType +
                            line.text.slice(firstIdxAfterversionClauseType).indexOf(currentVersion)
                        endIdx = startIdx + currentVersion.length
                    }
                    const startposition = new vscode.Position(lineNumber, startIdx)
                    const endingposition = new vscode.Position(lineNumber, endIdx)
                    const range = new vscode.Range(startposition, endingposition)

                    editBuilder.replace(range, versionClauseType === undefined ? '==' + latestVersion : latestVersion)
                }
            })
        }
    }

    context.subscriptions.push(vscode.commands.registerCommand(bumpPackageCommand, bumpPackageCommandHandler))
}

export function deactivate() {
    metadataCache.clear()
}

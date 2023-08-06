import vscode from 'vscode'
import fetch, { FetchError, Response } from 'node-fetch'
import dayjs from 'dayjs'
import semver from 'semver'
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
async function fetchPackageMetadata(requirement: PackageRequirement): Promise<PackageMetadata> {
    if (metadataCache.has(requirement.id)) return metadataCache.get(requirement.id)!
    let response: Response
    try {
        response = await fetch(`https://pypi.org/pypi/${requirement.id}/json`)
    } catch (e) {
        const reason = e instanceof FetchError ? e.code : (e as Error).message
        throw new Error(`Could not connect to PyPI: ${reason}`)
    }
    let metadata: PackageMetadata
    switch (response.status) {
        case 200:
            metadata = await response.json()
            break
        case 404:
            throw new Error(`Package not found in PyPI`)
        default:
            throw new Error(`Unexpected ${response.status} response from PyPI`)
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

    async resolveCodeLens(codeLens: PyPICodeLens): Promise<vscode.CodeLens> {
        let title: string
        try {
            const metadata = await fetchPackageMetadata(codeLens.requirement)
            const packageVersion = metadata.info.version
            const constraintSpecifier = codeLens.requirement.constraints[0][0]
            const constraintVersion = codeLens.requirement.constraints[0][1]

            if (this.satisfies(packageVersion, constraintSpecifier, constraintVersion)) {
                title = this.formatPackageMetadata(metadata)
            } else {
                const outdatedTitle =
                    this.formatPackageMetadata(metadata) +
                    `, installed version: ${constraintVersion} (update available)`
                title = outdatedTitle
            }
        } catch (e) {
            title = (e as Error).message
        }
        return new vscode.CodeLens(codeLens.range, {
            command: '',
            title,
        })
    }

    formatPackageMetadata(metadata: PackageMetadata): string {
        const { info } = metadata
        return `Latest version: ${info.version}`
    }

    // Helper function to check if a package version satisfies the specified requirement.
    satisfies(version: string, specifier: string, constraint: string): boolean {
        switch (specifier) {
            case '==':
                return semver.eq(version, constraint)
            default:
                return true
        }
    }
}

export function activate(_: vscode.ExtensionContext) {
    vscode.languages.registerCodeLensProvider('pip-requirements', new PyPICodeLensProvider())
    vscode.languages.registerHoverProvider('pip-requirements', new PyPIHoverProvider())
}

export function deactivate() {
    metadataCache.clear()
}

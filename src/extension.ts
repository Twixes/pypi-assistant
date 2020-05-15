import * as vscode from 'vscode'
import fetch, { Response } from 'node-fetch'

interface PackageRequirement {
    id: string
    id_raw: string
    extras: string[]
    constraints: [string, string][]
}

interface PackageInfo {
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

const deconstructionRe: RegExp = /^([\w\d._-]+)(\[[\w\d,._-]*\])?(?:(==|~=|>=?|<=?)([\w\d._-]+)(?:,(==|~=|>=?|<=?)([\w\d._-]+))?)?$/i

let infoPresentationCache: Map<string, string> = new Map()

function linkify(text: string, link?: string): string {
    return link ? `[${text}](${link})`: text
}

function extractPackageRequirement(line: vscode.TextLine): PackageRequirement | null {
    const match = line.text.replace(/\s/g, '').match(deconstructionRe)
    if (match === null) return null
    let constraints: [string, string][] = []
    if (match[4]) constraints.push([match[3], match[4]])
    if (match[6]) constraints.push([match[5], match[6]])
    return {
        id: match[1].toLowerCase().replace(/[._]/g, '-'),
        id_raw: match[1],
        extras: match[2] ? match[2].split(',') : [],
        constraints: constraints
    }
}

async function fetchPackageInfo(requirement: PackageRequirement): Promise<[number | null, PackageInfo | null]> {
    try {
        const response: Response = await fetch(`https://pypi.org/pypi/${requirement.id}/json`)
        let info: PackageInfo | null = null
        if (response.ok) info = (await response.json()).info
        return [response.status, info]
    } catch (e) {
        return [null, null]
    }
}

function presentPackageInfo(info: PackageInfo): string {
    const summarySubPart: string = info.summary ? ` – ${linkify(info.summary, info.home_page)}` : ''
    const headPart: string = `**${linkify(info.name, info.package_url)}${summarySubPart}**`
    const emailSubpart: string = info.author_email ? ` (${info.author_email})` : ''
    const authorSubpart: string = info.author && info.author_email ? `By ${info.author}${emailSubpart}.` : ''
    const licenseSubpart: string = info.license ? ` ${info.license.replace(/ licen[cs]e/gi, '')} licensed.` : ''
    const versionPart: string = `Latest version: ${linkify(info.version, info.release_url)}.`
    const infoPresentation: string = [
        headPart, authorSubpart + licenseSubpart, versionPart
    ].filter(Boolean).join('\n\n')
    return infoPresentation
}

async function provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const requirement: PackageRequirement | null = extractPackageRequirement(document.lineAt(position.line))
    if (requirement === null) return new vscode.Hover('')
    let infoPresentation: string | undefined = infoPresentationCache.get(requirement.id)
    if (infoPresentation === undefined) {
        const [status, info]: [number | null, PackageInfo | null] = await fetchPackageInfo(requirement)
        if (status === 200) infoPresentation = presentPackageInfo(info!)
        else if (status === 404) infoPresentation = `{id_raw} is not available in PyPI`
        if (infoPresentation) infoPresentationCache.set(requirement.id, infoPresentation)
        else infoPresentation = linkify(
            `could not fetch ${requirement.id_raw} information from PyPI`,
            `https://pypi.org/project/${requirement.id_raw}/`
        )
    }
    return new vscode.Hover(infoPresentation.replace('{id_raw}', requirement.id_raw))
}

export function activate(_: vscode.ExtensionContext) {
    vscode.languages.registerHoverProvider({ language: 'pip-requirements' }, { provideHover })
}

export function deactivate() {
    infoPresentationCache.clear()
}

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

type PackageInfoRequest = [number | null, PackageInfo | null]

const deconstructionRe: RegExp = /^([\w\d._-]+)(\[[\w\d,._-]*\])?(?:(==?|~=?|>=?|<=?)([\w\d._-]*)(?:,(?:(==?|~=?|>=?|<=?)([\w\d._-]*))?)*)?$/i

let infoPresentationCache: Map<string, Array<string>> = new Map()

function linkify(text: string, link?: string): string {
    return link ? `[${text}](${link})`: text
}

function extractPackageRequirement(line: vscode.TextLine): PackageRequirement | null {
    const match = line.text.replace(/(?:\s*(?:(?=#).*)?$|\s+)/g, '').match(deconstructionRe)
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

async function fetchPackageInfo(requirement: PackageRequirement): Promise<PackageInfoRequest> {
    try {
        const response: Response = await fetch(`https://pypi.org/pypi/${requirement.id}/json`)
        let info: PackageInfo | null = null
        if (response.ok) info = (await response.json() as { info: PackageInfo}).info
        return [response.status, info]
    } catch (e) {
        return [null, null]
    }
}

function presentPackageInfo(info: PackageInfo): string[] {
    const summarySubPart: string = info.summary ? ` – ${linkify(info.summary, info.home_page)}` : ''
    const headPart: string = `**${linkify(info.name, info.package_url)}${summarySubPart}**`
    const emailSubpart: string = info.author_email ? ` (${info.author_email})` : ''
    const authorSubpart: string = info.author && info.author_email ? `By ${info.author}${emailSubpart}.` : ''
    const licenseSubpart: string = info.license ? ` ${info.license.replace(/ licen[cs]e/gi, '')} licensed.` : ''
    const versionPart: string = `Latest version: ${linkify(info.version, info.release_url)}.`
    const infoPresentation: Array<string> = [
        headPart, authorSubpart + licenseSubpart, versionPart
    ].filter(Boolean)

    return infoPresentation
}

async function provideHover(document: vscode.TextDocument, position: vscode.Position) {
    const requirement: PackageRequirement | null = extractPackageRequirement(document.lineAt(position.line))
    if (requirement === null) return new vscode.Hover('')
    let infoPresentation: Array<string> | undefined = infoPresentationCache.get(requirement.id)
    if (infoPresentation === undefined) return new vscode.Hover('')
    return new vscode.Hover(infoPresentation.join("\n\n").replace('{id_raw}', requirement.id_raw))
}

class CodeLensProvider implements vscode.CodeLensProvider {
    async provideCodeLenses(document: vscode.TextDocument): Promise<vscode.CodeLens[]> {

      const lineCount: number = document.lineCount;

      const infoPresentations: Promise<vscode.Command[]> = Promise.all([...Array(lineCount).keys()]
        .map(async (lineNumber)=>{
        const requirement: PackageRequirement | null = extractPackageRequirement(document.lineAt(lineNumber))
        if (requirement === null) return { command: "", title: ""}
        let infoPresentation: Array<string> | undefined = infoPresentationCache.get(requirement.id)
        if (infoPresentation === undefined) {
          const [status, info]: PackageInfoRequest = await fetchPackageInfo(requirement)
          if (status === 200) infoPresentation = presentPackageInfo(info!)
          else {/* {id_raw} is not available in PyPI */} 

          if (infoPresentation) infoPresentationCache.set(requirement.id, infoPresentation)
          else return { command: "", title: ""} // could not fetch ${requirement.id_raw} information from PyPI
        }

        // Extract version number from square brackets
        const latestVersionNumber = /\[(.*?)\]/.exec(infoPresentation.slice(-1)[0])?.[1]
        return {command: "", title: latestVersionNumber ? `Latest version: ${latestVersionNumber}` : ""}
      }))

      return (await infoPresentations)
      .reduce((acc: Array<vscode.CodeLens>,curr,currIdx)=>{
          const [infoPresentation, idx] = [curr,currIdx]
          return infoPresentation.title !== "" ? acc.concat(
            (new vscode.CodeLens(new vscode.Range(idx, 0, idx, 0), infoPresentation))
          ) : acc
      },[])

    }
  }

export function activate(_: vscode.ExtensionContext) {
    vscode.languages.registerCodeLensProvider('pip-requirements', new CodeLensProvider()),
    vscode.languages.registerHoverProvider('pip-requirements', { provideHover })
}

export function deactivate() {
    infoPresentationCache.clear()
}

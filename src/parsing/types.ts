export type RawRange = [startLine: number, startCharacter: number, endLine: number, endCharacter: number]

export interface PositionLike {
    line: number
    character: number
}

export interface RangeLike {
    start: PositionLike
    end: PositionLike
}

export interface TextDocumentLike {
    lineCount: number
    lineAt(line: number): { text: string; range: RangeLike }
    getText(): string
}

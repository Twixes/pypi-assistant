import { PyPICompletionItemProvider, PackageMetadata } from './extension'
import { RequirementsParser } from './parsing'
import { PyPI } from './pypi'
import { LooseProjectNameRequirementWithLocation } from 'pip-requirements-js'
import { RequirementFound } from './parsing/types'
import { LRUCache } from 'lru-cache'

// Mock output channel
jest.mock('./output', () => ({
    outputChannel: {
        appendLine: jest.fn(),
    },
}))

// Mock wretch and PyPI dependencies
jest.mock('wretch', () => jest.fn())
jest.mock('wretch/resolver', () => ({
    WretchError: class WretchError extends Error {
        status: number
        json: any
        constructor(message: string, status: number = 500) {
            super(message)
            this.status = status
            this.json = {}
        }
    },
}))

jest.mock('./pypi', () => ({
    PyPI: jest.fn().mockImplementation(() => ({
        fetchPackageMetadata: jest.fn(),
        clear: jest.fn(),
        cache: new Map(),
    })),
}))

jest.mock('./parsing', () => ({
    RequirementsParser: jest.fn().mockImplementation(() => ({
        getAll: jest.fn(),
        getAtPosition: jest.fn(),
        parseLineForCompletion: jest.fn(),
        extractQuotedStringFromPosition: jest.fn(),
        clear: jest.fn(),
        cache: new Map(),
    })),
}))

// Mock vscode namespace
jest.mock(
    'vscode',
    () => ({
        CompletionItem: jest.fn().mockImplementation((label: string, kind: number) => ({
            label,
            kind,
            insertText: '',
            sortText: '',
            range: undefined,
        })),
        CompletionItemKind: {
            Constant: 21,
        },
        Range: jest.fn().mockImplementation((start: any, end: any) => ({
            start,
            end,
        })),
        Position: jest.fn().mockImplementation((line: number, character: number) => ({
            line,
            character,
            translate: jest.fn((lineDelta: number, charDelta: number) => ({
                line: line + lineDelta,
                character: character + charDelta,
            })),
        })),
        CodeLens: jest.fn().mockImplementation((range: any, command?: any) => ({
            range,
            command,
        })),
        Hover: jest.fn().mockImplementation((contents: any, range?: any) => ({
            contents,
            range,
        })),
        languages: {
            registerCodeLensProvider: jest.fn(),
            registerHoverProvider: jest.fn(),
            registerCompletionItemProvider: jest.fn(),
        },
        workspace: {
            getConfiguration: jest.fn(),
        },
    }),
    { virtual: true }
)

const mockVscode = require('vscode')

describe('PyPICompletionItemProvider', () => {
    let provider: PyPICompletionItemProvider
    let mockRequirementsParser: jest.Mocked<RequirementsParser>
    let mockPypi: jest.Mocked<PyPI>
    let mockDocument: any
    let mockPosition: any

    const mockPackageMetadata: PackageMetadata = {
        info: {
            name: 'requests',
            summary: 'HTTP library',
            home_page: 'https://requests.readthedocs.io',
            author: 'Kenneth Reitz',
            author_email: 'me@kennethreitz.org',
            package_url: 'https://pypi.org/project/requests/',
            license: 'Apache 2.0',
            version: '2.28.0',
            release_url: 'https://pypi.org/project/requests/2.28.0/',
        },
        releases: {
            '2.28.0': [{ upload_time: '2022-06-29T00:00:00' }],
            '2.27.1': [{ upload_time: '2022-01-05T00:00:00' }],
            '2.27.0': [{ upload_time: '2022-01-03T00:00:00' }],
            '1.0.0-beta': [{ upload_time: '2021-01-01T00:00:00' }],
        },
    }

    // Helper function to create mock requirements with proper typing
    function createMockRequirement(
        name: string,
        operator?: string,
        version?: string
    ): LooseProjectNameRequirementWithLocation {
        return {
            data: {
                type: 'ProjectName',
                name: {
                    data: name,
                    location: { startIdx: 0, endIdx: name.length },
                },
                versionSpec:
                    operator && version
                        ? [
                              {
                                  data: {
                                      operator: {
                                          data: operator,
                                          location: { startIdx: name.length, endIdx: name.length + operator.length },
                                      },
                                      version: {
                                          data: version,
                                          location: {
                                              startIdx: name.length + operator.length,
                                              endIdx: name.length + operator.length + version.length,
                                          },
                                      },
                                  },
                                  location: {
                                      startIdx: name.length,
                                      endIdx: name.length + operator.length + version.length,
                                  },
                              },
                          ]
                        : undefined,
            },
            location: { startIdx: 0, endIdx: name.length + (operator?.length || 0) + (version?.length || 0) },
        }
    }

    // Helper function to create mock ranges
    function createMockRange(startLine: number, startChar: number, endLine: number, endChar: number) {
        return new mockVscode.Range(
            new mockVscode.Position(startLine, startChar),
            new mockVscode.Position(endLine, endChar)
        )
    }

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks()

        // Create actual mock instances
        mockRequirementsParser = {
            getAll: jest.fn(),
            getAtPosition: jest.fn(),
            parseLineForCompletion: jest.fn(),
            extractQuotedStringFromPosition: jest.fn(),
            clear: jest.fn(),
            cache: new LRUCache({ max: 200 }),
        } as jest.Mocked<RequirementsParser>

        mockPypi = {
            fetchPackageMetadata: jest.fn(),
            clear: jest.fn(),
            cache: new Map(),
        } as jest.Mocked<PyPI>

        provider = new PyPICompletionItemProvider(mockRequirementsParser, mockPypi)

        mockDocument = {
            lineAt: jest.fn(),
            uri: { toString: () => 'file:///test/requirements.txt' },
            version: 1,
        } as any

        mockPosition = new mockVscode.Position(0, 10)
    })

    describe('provideCompletionItems', () => {
        describe('basic functionality', () => {
            it('should return undefined when no requirement match before cursor', async () => {
                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'invalid line content',
                })

                const result = await provider.provideCompletionItems(mockDocument, mockPosition, {} as any, {} as any)

                expect(result).toEqual([])
            })

            it('should return undefined when requirements parser cannot find requirement at position', async () => {
                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue(null)

                const result = await provider.provideCompletionItems(mockDocument, mockPosition, {} as any, {} as any)

                expect(result).toEqual([])
            })

            it('should provide version completions for basic package name without operator', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 8)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                expect(result).toBeInstanceOf(Promise)
                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
                expect(items[1].label).toBe('==2.27.1')
                expect(items[2].label).toBe('==2.27.0')
                expect(items[3].label).toBe('==1.0.0-beta')
            })
        })

        describe('operator handling', () => {
            it('should provide version completions with existing == operator', async () => {
                const mockRequirement = createMockRequirement('requests', '==', '')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 10)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0') // Should include full operator+version
            })

            it('should provide version completions with >= operator', async () => {
                const mockRequirement = createMockRequirement('requests', '>=', '')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests>=',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 11)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 11),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should handle complete operator != (cursor after !=)', async () => {
                const mockRequirement = createMockRequirement('requests', '!=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests!=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('!=2.28.0')
                expect(items[0].insertText).toBe('!=2.28.0') // Should include full operator+version
            })

            it('should handle ~= operator correctly', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests~=',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 11),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })
        })

        describe('cursor positioning edge cases', () => {
            it('should handle cursor before = in partial operator', async () => {
                const mockRequirement = createMockRequirement('requests', '=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 15)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should handle cursor before complete operator (opTwo branch)', async () => {
                const mockRequirement = createMockRequirement('requests', '>=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests>=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor positioned right before the ">=" operator (after package name)
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('>=2.28.0')
                expect(items[0].insertText).toBe('>=2.28.0')
            })

            it('should handle cursor between > and = in >= operator (critical edge case)', async () => {
                const mockRequirement = createMockRequirement('requests', '>=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests>=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor positioned between ">" and "=" in ">=" operator
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                // This should work but likely fails due to regex gap - cursor between > and =
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('>=2.28.0')
                expect(items[0].insertText).toBe('>=2.28.0')
            })

            it('should handle cursor in middle of <= operator', async () => {
                const mockRequirement = createMockRequirement('requests', '<=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests<=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor between "<" and "=" in valid "<=" operator (requests<|=2.28.0)
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                // BUG: Produces "==" instead of "<=" due to opPartTwo branch logic
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('<=2.28.0')
                expect(items[0].insertText).toBe('<=2.28.0')
            })

            it('should handle cursor in middle of == operator', async () => {
                const mockRequirement = createMockRequirement('requests', '==', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor between first "=" and second "=" in valid "==" operator (requests=|=2.28.0)
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                // Fixed: Single "=" now handled correctly
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0') // Should include full operator+version
            })

            it('should handle cursor in middle of === operator', async () => {
                const mockRequirement = createMockRequirement('requests', '===', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests===2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 17)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor between second "=" and third "=" in valid "===" operator (requests==|=2.28.0)
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                // BUG: Produces "==" instead of "===" due to opPartTwo branch logic
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('===2.28.0')
                expect(items[0].insertText).toBe('===2.28.0')
            })

            it('should handle single = and suggest == completions (UX improvement)', async () => {
                const mockRequirement = createMockRequirement('requests', '=', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests=2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 15)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor after single "=" - should help user by suggesting == (requests=|2.28.0)
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                // EXPECTED UX: Should suggest == versions (add one = to make it valid)
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0') // Insert full operator+version

                // BUG: Currently fails completely because single "=" not handled
            })

            it('should handle cursor at end of line after complete requirement', async () => {
                const mockRequirement = createMockRequirement('requests', '==', '2.28.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==2.28.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor at very end of line
                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 16),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })
        })

        describe('multiple version specs', () => {
            it('should handle multiple version specs separated by commas', async () => {
                const mockRequirement: LooseProjectNameRequirementWithLocation = {
                    data: {
                        type: 'ProjectName',
                        name: {
                            data: 'foobar',
                            location: { startIdx: 0, endIdx: 6 },
                        },
                        versionSpec: [
                            {
                                data: {
                                    operator: {
                                        data: '>=',
                                        location: { startIdx: 6, endIdx: 8 },
                                    },
                                    version: {
                                        data: '0.1',
                                        location: { startIdx: 8, endIdx: 11 },
                                    },
                                },
                                location: { startIdx: 6, endIdx: 11 },
                            },
                            {
                                data: {
                                    operator: {
                                        data: '<',
                                        location: { startIdx: 12, endIdx: 13 },
                                    },
                                    version: {
                                        data: '0.3',
                                        location: { startIdx: 13, endIdx: 16 },
                                    },
                                },
                                location: { startIdx: 12, endIdx: 16 },
                            },
                        ],
                    },
                    location: { startIdx: 0, endIdx: 16 },
                }

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'foobar>=0.1,<0.3',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor within first version spec
                const result1 = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 9),
                    {} as any,
                    {} as any
                )

                const items1 = (await result1) as any[]
                expect(items1).toHaveLength(4)
                expect(items1[0].label).toBe('>=2.28.0')

                // Cursor within second version spec
                const result2 = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 14),
                    {} as any,
                    {} as any
                )

                const items2 = (await result2) as any[]
                expect(items2).toHaveLength(4)
                expect(items2[0].label).toBe('<2.28.0')
            })

            it('should handle cursor after comma in multi-spec requirement', async () => {
                const mockRequirement: LooseProjectNameRequirementWithLocation = {
                    data: {
                        type: 'ProjectName',
                        name: {
                            data: 'foobar',
                            location: { startIdx: 0, endIdx: 6 },
                        },
                        versionSpec: [
                            {
                                data: {
                                    operator: {
                                        data: '>=',
                                        location: { startIdx: 6, endIdx: 8 },
                                    },
                                    version: {
                                        data: '0.1',
                                        location: { startIdx: 8, endIdx: 11 },
                                    },
                                },
                                location: { startIdx: 6, endIdx: 11 },
                            },
                        ],
                    },
                    location: { startIdx: 0, endIdx: 11 },
                }

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'foobar>=0.1, ',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 13)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor after comma and space (should suggest complementary operator)
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('<2.28.0') // Complementary to >=
            })
        })

        describe('wildcard and pattern versions', () => {
            it('should handle wildcard versions (*)', async () => {
                const mockRequirement = createMockRequirement('pytest-mock', '=', '*')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'pytest-mock = "*"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 17)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor within wildcard version
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle pattern versions (4.4.*)', async () => {
                const mockRequirement = createMockRequirement('pycares', '==', '4.4.*')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'pycares==4.4.*',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 14)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor within pattern version
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 11),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle cursor at asterisk in pattern version', async () => {
                const mockRequirement = createMockRequirement('pycares', '==', '4.4.*')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'pycares==4.4.*',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 14)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor right at the asterisk
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })
        })

        describe('environment markers and comments', () => {
            it('should not provide completions after environment markers (semicolon)', async () => {
                const mockRequirement = createMockRequirement('django', '>', '2.1')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: "django>2.1; os_name != 'nt'",
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 27)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor after semicolon (environment marker)
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([])
            })

            it('should not provide completions after comments (hash)', async () => {
                const mockRequirement = createMockRequirement('pycares', '==', '4.4.*')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'pycares==4.4.* # Without this, an older version is installed',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 14)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor after hash (comment)
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 20),
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([])
            })

            it('should provide completions before environment markers', async () => {
                const mockRequirement = createMockRequirement('django', '>', '2.1')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: "django>2.1; os_name != 'nt'",
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 10)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor before semicolon (within version spec)
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('>2.28.0')
            })

            it('should handle complex environment marker edge cases', async () => {
                const mockRequirement = createMockRequirement('futures', '>=', '3.0.5')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: "futures>=3.0.5; python_version == '2.6' or python_version=='2.7'",
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 14)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor after complex environment marker
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 50),
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([])
            })
        })

        describe('extras and package names', () => {
            it('should handle package names with extras', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests[security]==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 19),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should handle cursor within extras syntax', async () => {
                const mockRequirement = createMockRequirement('gidgethub')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'gidgethub[httpx]>4.0.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 22)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor within the extras bracket [httpx] - current implementation provides completions after package name
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 12), // Within [httpx]
                    {} as any,
                    {} as any
                )

                // Current implementation treats this as cursor after package name and provides completions
                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle multiple extras with cursor in version spec', async () => {
                const mockRequirement = createMockRequirement('aiochclient', '==', '2.5.1')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'aiochclient[aiohttp-speedups]==2.5.1',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 36)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor within version spec after complex extras
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 32),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle package names with hyphens and underscores', async () => {
                const mockRequirement = createMockRequirement('test_package-name')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'test_package-name==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue({
                    ...mockPackageMetadata,
                    info: { ...mockPackageMetadata.info, name: 'test_package-name' },
                })

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 20),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].insertText).toBe('==2.28.0')
            })
        })

        describe('whitespace and formatting', () => {
            it('should handle leading/trailing whitespace in requirements', async () => {
                const mockRequirement = createMockRequirement('beautifulsoup4', '==', '4.10.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '   beautifulsoup4==4.10.0   ',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 3, 0, 24)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 20),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle complex operators with spaces', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests >= ',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 12),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })
        })

        describe('version management and sorting', () => {
            it('should replace existing version after cursor', async () => {
                const mockRequirement = createMockRequirement('requests', '==', '1.0.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==1.0.0',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 15)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].range).toBeDefined()
                // Range should be from position to end of existing version
            })

            it('should sort versions correctly (semver first, then non-semver)', async () => {
                const mockRequirement = createMockRequirement('test-package')
                const mockMetadataWithMixedVersions: PackageMetadata = {
                    info: {
                        name: 'test-package',
                        summary: 'Test package',
                        home_page: '',
                        author: '',
                        author_email: '',
                        package_url: '',
                        license: '',
                        version: '2.0.0',
                        release_url: '',
                    },
                    releases: {
                        '1.0.0': [{ upload_time: '2022-01-01T00:00:00' }],
                        '2.0.0': [{ upload_time: '2022-02-01T00:00:00' }],
                        '1.5.0': [{ upload_time: '2022-01-15T00:00:00' }],
                        'dev-branch': [{ upload_time: '2022-03-01T00:00:00' }],
                        'alpha-version': [{ upload_time: '2022-02-15T00:00:00' }],
                    },
                }

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'test-package==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockMetadataWithMixedVersions)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(5)
                // Should have semver versions first (sorted by semver), then non-semver alphabetically reversed
                expect(items[0].label).toBe('==2.0.0')
                expect(items[1].label).toBe('==1.5.0')
                expect(items[2].label).toBe('==1.0.0')
                expect(items[3].label).toBe('==dev-branch')
                expect(items[4].label).toBe('==alpha-version')
            })
        })

        describe('error handling', () => {
            it('should handle PyPI API errors gracefully', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockRejectedValue(new Error('Network error'))

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const resolved = await result
                expect(resolved).toEqual([])
            })

            it('should handle packages with missing upload_time entries (like older Django versions)', async () => {
                const mockRequirement = createMockRequirement('django')
                const mockDjangoMetadata: PackageMetadata = {
                    info: {
                        name: 'django',
                        summary: 'Web framework',
                        home_page: 'https://www.djangoproject.com/',
                        author: 'Django Software Foundation',
                        author_email: 'foundation@djangoproject.com',
                        package_url: 'https://pypi.org/project/django/',
                        license: 'BSD-3-Clause',
                        version: '5.0.0',
                        release_url: 'https://pypi.org/project/django/5.0.0/',
                    },
                    releases: {
                        '5.0.0': [{ upload_time: '2023-12-07T10:13:14' }],
                        '4.2.8': [{ upload_time: '2023-12-04T08:02:25' }],
                        '1.0': [], // Empty array - no upload_time data for older versions
                        '0.96': [], // Empty array - no upload_time data for older versions
                    },
                }

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'django==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 8)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockDjangoMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==5.0.0')
                expect(items[1].label).toBe('==4.2.8')
                expect(items[2].label).toBe('==1.0')
                expect(items[3].label).toBe('==0.96')

                // Check that items with missing upload_time show "unknown date"
                expect(items[0].detail).toBe('Released on 7 December 2023')
                expect(items[1].detail).toBe('Released on 4 December 2023')
                expect(items[2].detail).toBe('Released on unknown date')
                expect(items[3].detail).toBe('Released on unknown date')
            })

            it('should handle string requirements (non-parsed) gracefully', async () => {
                // String requirements are returned by parser for some pyproject.toml cases
                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '"requests"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue(['requests', createMockRange(0, 1, 0, 9)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([]) // String requirements don't get completions
            })

            it('should handle null package metadata gracefully', async () => {
                const mockRequirement = createMockRequirement('nonexistent-package')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'nonexistent-package==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 21)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(null as any)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 21),
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([])
            })

            it('should handle empty releases object', async () => {
                const mockRequirement = createMockRequirement('empty-package')
                const emptyMetadata: PackageMetadata = {
                    info: {
                        name: 'empty-package',
                        summary: '',
                        home_page: '',
                        author: '',
                        author_email: '',
                        package_url: '',
                        license: '',
                        version: '1.0.0',
                        release_url: '',
                    },
                    releases: {}, // Empty releases
                }

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'empty-package==',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 15)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(emptyMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(0) // No versions available
            })

            it('should handle invalid cursor positions', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 8)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                // Cursor before package name
                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 2), // Within package name
                    {} as any,
                    {} as any
                )

                expect(result).toEqual([]) // Should not provide completions within package name
            })
        })
    })

    describe('pyproject.toml completion support', () => {
        beforeEach(() => {
            mockDocument.languageId = 'toml'
            mockDocument.uri = {
                toString: () => 'file:///test/pyproject.toml',
                path: '/test/pyproject.toml',
            }
        })

        describe('standard sections', () => {
            it('should provide version completions for project.dependencies', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "requests"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should provide version completions for project.dependencies with existing operator', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "requests>="',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should provide version completions for project.optional-dependencies', async () => {
                const mockRequirement = createMockRequirement('pytest')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "pytest~="',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should provide version completions for dependency-groups (PEP 735)', async () => {
                const mockRequirement = createMockRequirement('black')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "black"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 10),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should provide version completions for build-system.requires', async () => {
                const mockRequirement = createMockRequirement('setuptools')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "setuptools!="',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 17),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })

            it('should handle package names with extras in pyproject.toml', async () => {
                const mockRequirement = createMockRequirement('requests')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "requests[security]=="',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 0, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 25),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]

                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
                expect(items[0].insertText).toBe('==2.28.0')
            })
        })

        describe('poetry sections', () => {
            it('should handle poetry dependencies section', async () => {
                const mockRequirement = createMockRequirement('requests', '^', '2.22.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests = "^2.22.0"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 11, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('^2.28.0')
            })

            it('should handle poetry group dependencies', async () => {
                const mockRequirement = createMockRequirement('pytest', '^', '6.0.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'pytest = "^6.0.0"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 9, 0, 17)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 13),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })
        })

        describe('uv sections', () => {
            it('should handle uv dev-dependencies', async () => {
                const mockRequirement = createMockRequirement('ruff', '==', '0.5.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'ruff = "==0.5.0"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 7, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 11),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle uv constraint-dependencies', async () => {
                const mockRequirement = createMockRequirement('grpcio', '<', '1.65')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'grpcio = "<1.65"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 9, 0, 16)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 12),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })
        })

        describe('pixi sections', () => {
            it('should handle pixi pypi-dependencies', async () => {
                const mockRequirement = createMockRequirement('requests', '^', '2.22.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'requests = "^2.22.0"',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 11, 0, 20)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 15),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('^2.28.0')
            })
        })

        describe('dependency-groups edge cases', () => {
            it('should handle dependency groups with operators', async () => {
                const mockRequirement = createMockRequirement('foo', '>', '1.0')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: 'group-b = ["foo>1.0"]',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 11, 0, 19)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 16),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })

            it('should handle dependency groups with simple names', async () => {
                const mockRequirement = createMockRequirement('foo')

                mockDocument.lineAt = jest.fn().mockReturnValue({
                    text: '    "foo",',
                })
                mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, createMockRange(0, 5, 0, 8)])
                mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

                const result = await provider.provideCompletionItems(
                    mockDocument,
                    new mockVscode.Position(0, 8),
                    {} as any,
                    {} as any
                )

                const items = (await result) as any[]
                expect(items).toHaveLength(4)
                expect(items[0].label).toBe('==2.28.0')
            })
        })
    })
})

import { PyPICompletionItemProvider, PackageMetadata } from './extension'
import { RequirementsParser } from './parsing'
import { PyPI } from './pypi'
import { ProjectNameRequirement } from 'pip-requirements-js'

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

    beforeEach(() => {
        // Reset all mocks
        jest.clearAllMocks()

        // Create actual mock instances
        mockRequirementsParser = {
            getAll: jest.fn(),
            getAtPosition: jest.fn(),
            clear: jest.fn(),
            cache: new Map(),
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
        it('should return undefined when no requirement match before cursor', async () => {
            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'invalid line content',
            })

            const result = await provider.provideCompletionItems(mockDocument, mockPosition, {} as any, {} as any)

            expect(result).toBeUndefined()
        })

        it('should return undefined when requirements parser cannot find requirement at position', async () => {
            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests==',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue(null)

            const result = await provider.provideCompletionItems(mockDocument, mockPosition, {} as any, {} as any)

            expect(result).toBeUndefined()
        })

        it('should provide version completions for basic package name without operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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

        it('should provide version completions with existing == operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests==',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0') // Should only insert version, not operator
        })

        it('should provide version completions with >= operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests>=',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 11),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('>=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should handle complete operator != (cursor after !=)', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests!=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0') // Complete operator, so just insert version
        })

        it('should handle cursor before = in partial operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('=2.28.0')
        })

        it('should handle cursor before complete operator (opTwo branch)', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests>=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests>=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('=2.28.0')
        })

        it('should handle cursor in middle of <= operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests<=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('=2.28.0')
        })

        it('should handle cursor in middle of == operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests==2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0') // Should insert only version since == is complete
        })

        it('should handle cursor in middle of === operator', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests===2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('=2.28.0')
        })

        it('should handle single = and suggest == completions (UX improvement)', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests=2.28.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('=2.28.0') // Insert one more = to complete ==

            // BUG: Currently fails completely because single "=" not handled
        })

        it('should replace existing version after cursor', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests==1.0.0',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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

        it('should handle package names with extras', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests[security]==',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 19),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should handle ~= operator correctly', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests~=',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 11),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('~=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should sort versions correctly (semver first, then non-semver)', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'test-package', type: 'ProjectName' }
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
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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

        it('should handle PyPI API errors gracefully', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests==',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockRejectedValue(new Error('Network error'))

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 10),
                {} as any,
                {} as any
            )

            const resolved = await result
            expect(resolved).toBeUndefined()
        })

        it('should handle complex operators with spaces', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'requests >= ',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 12),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('>=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should handle package names with hyphens and underscores', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'test_package-name', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: 'test_package-name==',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0')
        })
    })

    describe('pyproject.toml completion support', () => {
        it('should provide version completions for project.dependencies', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "requests"',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "requests>="',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 15),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('>=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should provide version completions for project.optional-dependencies', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'pytest', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "pytest~="',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 13),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('~=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should provide version completions for dependency-groups (PEP 735)', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'black', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "black"',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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

        it('should provide version completions for tool.uv.dev-dependencies', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'ruff', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "ruff=="',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0') // Complete operator, so just version
        })

        it('should provide version completions for build-system.requires', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'setuptools', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "setuptools!="',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
            mockPypi.fetchPackageMetadata.mockResolvedValue(mockPackageMetadata)

            const result = provider.provideCompletionItems(
                mockDocument,
                new mockVscode.Position(0, 17),
                {} as any,
                {} as any
            )

            const items = (await result) as any[]

            expect(items).toHaveLength(4)
            expect(items[0].label).toBe('!=2.28.0')
            expect(items[0].insertText).toBe('2.28.0')
        })

        it('should handle package names with extras in pyproject.toml', async () => {
            const mockRequirement: ProjectNameRequirement = { name: 'requests', type: 'ProjectName' }

            mockDocument.lineAt = jest.fn().mockReturnValue({
                text: '    "requests[security]=="',
            })
            mockRequirementsParser.getAtPosition.mockReturnValue([mockRequirement, {} as any])
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
            expect(items[0].insertText).toBe('2.28.0')
        })
    })
})

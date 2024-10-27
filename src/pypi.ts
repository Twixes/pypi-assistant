import { ProjectNameRequirement } from 'pip-requirements-js'
import { PackageMetadata } from './extension'
import wretch from 'wretch'
import { WretchError } from 'wretch/resolver'
import { outputChannel } from './output'

if (typeof process !== 'undefined') {
    wretch.polyfills({
        fetch: require('node-fetch'),
        FormData: require('form-data'),
    })
}

/** Fetching package metadata with a caching layer. */
export class PyPI {
    constructor(public cache: Map<string, () => Promise<PackageMetadata>> = new Map()) {}

    public async fetchPackageMetadata(requirement: ProjectNameRequirement): Promise<PackageMetadata> {
        if (!this.cache.has(requirement.name)) {
            this.cache.set(requirement.name, async () => {
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
                    this.cache.delete(requirement.name)
                    outputChannel.appendLine(`Error fetching package metadata for ${requirement.name} - ${e}`)
                    throw new Error('Cannot connect to PyPI')
                }
                return metadata
            })
        }
        return await this.cache.get(requirement.name)!()
    }

    public clear() {
        this.cache.clear()
    }
}

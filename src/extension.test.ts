import { extractPackageRequirement } from './parsing'

describe('extractPackageRequirement', () => {
    it('should extract package req with no version', () => {
        const req = extractPackageRequirement('bcrypt')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [],
        })
    })

    it('should extract package req with exact version', () => {
        const req = extractPackageRequirement('bcrypt==4.0.0')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [['==', '4.0.0']],
        })
    })

    it('should extract package req with greater than version', () => {
        const req = extractPackageRequirement('bcrypt>4.0.0')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [['>', '4.0.0']],
        })
    })

    it('should extract package req with greater or equal version', () => {
        const req = extractPackageRequirement('bcrypt>=4.0.0')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [['>=', '4.0.0']],
        })
    })

    it('should extract package req with missing exact version', () => {
        const req = extractPackageRequirement('bcrypt==')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [],
        })
    })

    it('should extract package req with wildcard AND greater or equal version', () => {
        const req = extractPackageRequirement('bcrypt==4.0.*,>=4.0.3')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [
                ['==', '4.0.*'],
                ['>=', '4.0.3'],
            ],
        })
    })

    it('should extract package req with wildcard', () => {
        const req = extractPackageRequirement('bcrypt==4.0.*')

        expect(req).toStrictEqual({
            id: 'bcrypt',
            extras: [],
            constraints: [['==', '4.0.*']],
        })
    })
})

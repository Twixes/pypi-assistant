import assert from 'assert'

import vscode from 'vscode'

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.')

    test('Sample test', () => {
        assert.equal(-1, [1, 2, 3].indexOf(5))
        assert.equal(-1, [1, 2, 3].indexOf(0))
    })
})

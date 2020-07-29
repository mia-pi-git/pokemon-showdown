/**
 * Tests for the Help room auto-answerer.
 * Written by mia-pi.
 */

'use strict';

const assert = require('assert').strict;

const defaultData = {
	stats: {},
	pairs: {},
	disabled: false,
	queue: [],
};

describe('Help', function () {
	it('should only return true on added regexes', function () {
		const Answerer = require('../../../.server-dist/chat-plugins/help').HelpAnswerer;
		const Help = new Answerer(data);
		const data = {
			stats: {},
			pairs: {
				catra: [Help.stringRegex(`Hey & adora`)],
			},
			disabled: false,
			queue: [],
		};
		assert.ok(Help.match('Hey, adora', 'catra'));
		assert.ok(!Help.match('Hello, adora', 'catra'));
	});

	it('should produce valid regexes', function () {
		const Answerer = require('../../../.server-dist/chat-plugins/help').HelpAnswerer;
		const Help = new Answerer(defaultData);
		const regexString = Help.stringRegex(`uwu & owo`);
		assert.strictEqual(regexString, "(?=.*?(uwu))(?=.*?(awa))");
		const regex = new RegExp(regexString);
		assert.ok(regex.test('uwu awa'));
	});
	it('should handle |, &, and ! correctly', function () {
		const Answerer = require('../../../.server-dist/chat-plugins/help').HelpAnswerer;
		const Help = new Answerer(defaultData);

		const and = new RegExp(Help.stringRegex(`horde & prime`));
		assert.ok(and.test('horde prime'));
		assert.ok(!and.test('horde'));

		const or = new RegExp(Help.stringRegex(`ADVENTURE|why did you bring him here`));
		assert.ok(or.test('ADVENTURE'));
		assert.ok(or.test(`why did you bring him here`));
		assert.ok(!or.test('FOR THE HONOR OF GRAYSKULL'));

		const ignore = new RegExp(Help.stringRegex(`!hordak`));
		assert.ok(ignore.test(`entrapta`));
		assert.ok(!ignore.test('hordak'));
	});
});

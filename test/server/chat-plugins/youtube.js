/**
 * Tests for the Youtube room plugin.
 * Written by mia-pi.
 */
'use strict';
const YoutubeInterface = require('../../../.server-dist/chat-plugins/youtube').YoutubeInterface;
const assert = require('../../assert').strict;

describe(`Youtube features`, function () {
	it(`should correctly add channels to the database`, async function () {
		const Youtube = new YoutubeInterface({});
		const url = 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw';
		await Youtube.getChannelData(url, undefined, false);
		assert.ok(Youtube.data['UCuAXFkgsw1L7xaCfnd5JJOw']);
	});

	it(`should correctly handle PS names and channel names`, async function () {
		const Youtube = new YoutubeInterface({});
		const url = 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw';
		const channelId = 'UCuAXFkgsw1L7xaCfnd5JJOw';
		await Youtube.getChannelData(url, 'Pickle Rick', false);
		assert.strictEqual(channelId, Youtube.channelSearch('Pickle Rick'));
		assert.strictEqual(channelId, Youtube.channelSearch('Official Rick Astley'));
	});

	it(`should correctly parse channel links`, function () {
		const videoUrl = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
		const channelUrl = 'https://www.youtube.com/channel/UCuAXFkgsw1L7xaCfnd5JJOw';
		const Youtube = new YoutubeInterface({});
		const videoId = Youtube.getId(videoUrl);
		assert.strictEqual('dQw4w9WgXcQ', videoId);
		const channelId = Youtube.getId(channelUrl);
		assert.strictEqual('UCuAXFkgsw1L7xaCfnd5JJOw', channelId);
	});
});

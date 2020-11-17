const {LogSearcher} = require('../../../.server-dist/chat-plugins/chatlog');

describe("Chatlog features", () => {
	describe("Chatlog searcher", () => {
		const nameRegex = LogSearcher.constructUserRegex('mia');
		const searchOpts = {
			raw: true, options: {cwd: `${__dirname}/../../`, maxBuffer: 67108864},
			overwriteArgs: true, args: ['-e', nameRegex, '-i', 'fixtures/'],
		};
		it.skip("should support searching for a specific user (ripgrep)", async () => {
			const {results} = await LogSearcher.ripgrepSearchMonth(searchOpts);
		});
	});
});

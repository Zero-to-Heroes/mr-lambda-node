/* eslint-disable @typescript-eslint/no-use-before-define */
import { TriggerWatcherEvent } from '../mr-lambda-common/models/trigger-watcher-event';
import { Db } from '../mr-lambda-common/services/db';
import { Sqs } from '../mr-lambda-common/services/sqs';
import { sleep } from '../mr-lambda-common/services/utils';

// We assume the global timeout for the function will be 600 seconds
const TIMEOUT_LIMIT = 1000 * 500;
// It the phase takes too long, cancel it for now
const MAX_ALLOWED_EXECUTION_TIME = 1000 * 60 * 60 * 2;

const sqs = new Sqs();
const db = new Db();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', event);
	const start = Date.now();
	const triggerEvent: TriggerWatcherEvent = event.Records.map(event => JSON.parse(event.body))[0];

	let numberOfFiles = 0;
	while ((numberOfFiles = await countOutputFiles(triggerEvent)) < 1) {
		console.log('Aggregation completion progress', numberOfFiles + '/' + 1);
		await sleep(2000);

		// We start a new process before this one times out, and the new process will resume
		// where we left, since if will always use the number of files as stored in db
		if (Date.now() - start > TIMEOUT_LIMIT && Date.now() - start < MAX_ALLOWED_EXECUTION_TIME) {
			await sqs.sendMessageToQueue(triggerEvent, process.env.SQS_AGGREGATOR_WATCHER_URL);
			return;
		}
	}
	console.log('Aggregation phase done! Should send an email here');
	return { statusCode: 200, body: '' };
};

const countOutputFiles = async (event: TriggerWatcherEvent): Promise<number> => {
	return await db.countFilesCompleted(event.jobRootFolder, event.folder);
};

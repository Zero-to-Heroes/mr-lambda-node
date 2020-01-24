/* eslint-disable @typescript-eslint/no-use-before-define */
import { implementation } from '../implementation/implementation';
import { MapEvent } from '../mr-lambda-common/models/map-event';
import { TriggerWatcherEvent } from '../mr-lambda-common/models/trigger-watcher-event';
import { Sqs } from '../mr-lambda-common/services/sqs';
import { partitionArray } from '../mr-lambda-common/services/utils';

const MAPPER_FOLDER = 'mapper';
const REVIEWS_PER_MAPPER = 300;

const sqs = new Sqs();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', event);
	const jobName: string = event.jobName;
	const jobBucketName = Date.now() + '-' + jobName + '-' + Math.random() * 1000000;
	console.log('starting map/reduce on lambda', jobName);
	const reviewIds: readonly string[] = await implementation.loadReviewIds();
	startMappingPhase(reviewIds, jobBucketName);
	console.log('mapping phase trigger sent');
	sqs.sendMessageToQueue(
		{
			bucket: process.env.S3_BUCKET,
			folder: MAPPER_FOLDER,
			jobRootFolder: jobBucketName,
			expectedNumberOfFiles: reviewIds.length,
		} as TriggerWatcherEvent,
		process.env.SQS_MAPPER_WATCHER_URL,
	);
	return { statusCode: 200, body: '' };
};

const startMappingPhase = (reviewIds: readonly string[], jobBucketName: string) => {
	console.log('about to handle', reviewIds.length, 'files');
	const idsPerMapper: readonly string[][] = partitionArray(reviewIds, REVIEWS_PER_MAPPER);
	const mapEvents = idsPerMapper.map(idsForMapper => buildSqsMapEvents(idsForMapper, jobBucketName));
	sqs.sendMessageToQueue(mapEvents, process.env.SQS_MAPPER_URL);
	console.log('sent all SQS messages to mapper');
};

const buildSqsMapEvents = (reviewIds: readonly string[], jobBucketName: string) => {
	return {
		reviewIds: reviewIds,
		bucket: process.env.S3_BUCKET,
		jobRootFolder: jobBucketName,
		folder: MAPPER_FOLDER,
	} as MapEvent;
};

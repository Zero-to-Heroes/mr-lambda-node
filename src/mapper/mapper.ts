/* eslint-disable @typescript-eslint/no-use-before-define */
import { parseHsReplayString, Replay } from '@firestone-hs/hs-replay-xml-parser/dist/public-api';
import { getImplementation } from '../implementation/implementation';
import { MapEvent } from '../mr-lambda-common/models/map-event';
import { MapOutput } from '../mr-lambda-common/models/map-output';
import { MiniReview } from '../mr-lambda-common/models/mini-review';
import { Db } from '../mr-lambda-common/services/db';
import { ReviewDao } from '../mr-lambda-common/services/review-dao';
import { S3 } from '../mr-lambda-common/services/s3';

const db = new Db();
const s3 = new S3();
const reviewDao = new ReviewDao();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event, context): Promise<any> => {
	const mapEvents: readonly MapEvent[] = (event.Records as any[])
		.map(event => JSON.parse(event.body))
		.reduce((a, b) => a.concat(b), []);
	// let currentMapEvent = 0;
	for (const mapEvent of mapEvents) {
		let currentReviewId = 0;
		for (const reviewId of mapEvent.reviewIds) {
			currentReviewId++;
			const fileName = 'mapper-' + reviewId;
			if (await db.hasEntry(mapEvent.jobRootFolder, mapEvent.folder, reviewId)) {
				console.warn('Multiple processing ' + mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + reviewId);
				continue;
			}

			try {
				await db.logEntry(mapEvent.jobRootFolder, mapEvent.folder, fileName, reviewId, 'STARTED');
			} catch (e) {
				console.warn(
					'Could not insert row ' + mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + reviewId,
					e,
				);
				continue;
			}
			const currentMetric = await processMapEvent(reviewId, mapEvent.implementation);
			const fileKey = mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + fileName;
			const mapOutput: MapOutput = {
				output: currentMetric,
			} as MapOutput;
			const result = await s3.writeFile(mapOutput, mapEvent.bucket, fileKey);
			await db.updateEntry(
				mapEvent.jobRootFolder,
				mapEvent.folder,
				fileName,
				reviewId,
				result ? 'WRITTEN_TO_S3' : 'ERROR_IN_S3',
			);
		}
	}
	return { statusCode: 200, body: '' };
};

const processMapEvent = async (reviewId: string, implementation: string) => {
	const miniReview: MiniReview = await reviewDao.getMiniReview(reviewId);
	if (!miniReview || !miniReview.replayKey) {
		return null;
	}
	const replayString = miniReview.replayKey.endsWith('.zip')
		? await s3.readZippedContent('xml.firestoneapp.com', miniReview.replayKey)
		: await s3.readContentAsString('xml.firestoneapp.com', miniReview.replayKey);
	const replay: Replay = parseHsReplayString(replayString);
	if (!replay) {
		return null;
	}
	const output = await getImplementation(implementation).extractMetric(replay, miniReview, replayString);
	return output;
};

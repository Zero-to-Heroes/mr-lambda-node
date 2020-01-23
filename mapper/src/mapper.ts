/* eslint-disable @typescript-eslint/no-use-before-define */
import { implementation } from '../../implementation/src/implementation';
import { MapEvent } from '../../mr-lambda-common/src/models/map-event';
import { MapOutput } from '../../mr-lambda-common/src/models/map-output';
import { MiniReview } from '../../mr-lambda-common/src/models/mini-review';
import { Db } from '../../mr-lambda-common/src/services/db';
import { ReviewDao } from '../../mr-lambda-common/src/services/review-dao';
import { S3 } from '../../mr-lambda-common/src/services/s3';

const db = new Db();
const s3 = new S3();
const reviewDao = new ReviewDao();

// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', event);
	const mapEvents: readonly MapEvent[] = event.records.map(event => event.body);
	console.log('handling map events', mapEvents);
	// let currentMapEvent = 0;
	for (const mapEvent of mapEvents) {
		// currentMapEvent++;
		console.log('processing map event', mapEvent);
		let currentReviewId = 0;
		for (const reviewId of mapEvent.reviewIds) {
			currentReviewId++;
			const fileName = 'mapper-' + reviewId;
			if (db.hasEntry(mapEvent.jobRootFolder, mapEvent.folder, reviewId)) {
				console.warn('Multiple processing ' + mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + reviewId);
				continue;
			}

			try {
				db.logEntry(mapEvent.jobRootFolder, mapEvent.folder, fileName, reviewId, 'STARTED');
			} catch (e) {
				console.warn('Multiple processing ' + mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + reviewId);
				continue;
			}
			const currentMetric = processMapEvent(reviewId);
			const fileKey = mapEvent.jobRootFolder + '/' + mapEvent.folder + '/' + fileName;
			const mapOutput: MapOutput = {
				output: currentMetric,
			} as MapOutput;
			console.log(
				'Writing file ' + currentReviewId + '/' + mapEvent.reviewIds.length,
				' with ' + fileKey,
				' with contents ' + mapOutput,
				' to bucket ' + mapEvent.bucket,
			);
			s3.writeFile(mapOutput, mapEvent.bucket, fileKey);
			db.updateEntry(mapEvent.jobRootFolder, mapEvent.folder, fileName, reviewId, 'WRITTEN_TO_S3');
		}
	}
	return { statusCode: 200, body: '' };
};

const processMapEvent = async (reviewId: string) => {
	console.log('procesing review id', reviewId);
	const miniReview: MiniReview = await reviewDao.getMiniReview(reviewId);
	console.log('loaded mini review', miniReview);
	if (!miniReview.authorId) {
		console.warn('Missing author id', miniReview);
	}
	const replayAsString = await s3.readContentAsString('com.zerotoheroes.output', miniReview.key);
	console.log('Loaded replay as a string. First characters are ' + replayAsString.substring(0, 100));
	const output = await implementation.extractMetric(replayAsString, miniReview);
	return output;
};

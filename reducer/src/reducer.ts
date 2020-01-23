// This example demonstrates a NodeJS 8.10 async handler[1], however of course you could use
// the more traditional callback-style handler.
// [1]: https://aws.amazon.com/blogs/compute/node-js-8-10-runtime-now-available-in-aws-lambda/
export default async (event): Promise<any> => {
	console.log('event', event);
	const reduceEvents = event.records.map(event => event.body);
	console.log('handling', reduceEvents.length, 'reduce events');
	
	int currentReduceEvent = 0;
	for (ReduceEvent reduceEvent : reduceEvents) {
		currentReduceEvent++;
		logger.log("Processing reduce event " + currentReduceEvent + "/" + reduceEvents.size());
		String bucket = reduceEvent.getBucket();
		String jobRoot = reduceEvent.getJobRootFolder();
		String folder = reduceEvent.getOutputFolder();
		String eventId = reduceEvent.getEventId();
		String fileName = "reducer-" + eventId;
		if (db.hasEntry(jobRoot, folder, eventId)) {
			logger.log("!! Multiple processing: entry already exists: " + jobRoot + "/" + folder + "/" + eventId);
			continue;
		}
		try {
			db.logEntry(jobRoot, folder, fileName, eventId, "STARTED");
		}
		catch (Exception e) {
			logger.log("!! Multiple processing: entry already exists: " + jobRoot + "/" + folder + "/" + eventId);
			continue;
		}
		ReduceOutput output = processReduceEvent(reduceEvent);
		ReduceOutput reduceOutput = ReduceOutput.builder().output(output.getOutput()).build();
		String fileKey = jobRoot + "/" + folder + "/" + fileName;
		logger.log("Writing file " + fileKey + " with contents " + reduceOutput + " to bucket " + bucket);
		s3.writeFile(reduceOutput, bucket, fileKey);
		db.updateEntry(jobRoot, folder, fileName, eventId, "WRITTEN_TO_S3");
	}

	const mapEvents: readonly MapEvent[] = event.records.map(event => event.body);
	console.log('handling map events', mapEvents);
	let currentMapEvent = 0;
	for (let mapEvent of mapEvents) {
		currentMapEvent++;
		console.log('processing map event', mapEvent);
		let currentReviewId = 0;
		for (let reviewId of mapEvent.reviewIds) {
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

const processMapEvent = (reviewId: string) => {
	console.log('procesing review id', reviewId);
	const miniReview: MiniReview = reviewDao.getMiniReview(reviewId);
	console.log('loaded mini review', miniReview);
	if (!miniReview.authorId) {
		console.warn('Missing author id', miniReview);
	}
	const replayAsString = s3.readContentAsString('com.zerotoheroes.output', miniReview.key);
	console.log('Loaded replay as a string. First characters are ' + replayAsString.substring(0, 100));
	const output = implementation.extractMetric(replayAsString, miniReview);
	return output;
};

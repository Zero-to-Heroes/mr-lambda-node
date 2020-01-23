package com.zerotoheroes.mr.watcher.reducer;

import com.zerotoheroes.mr.common.Logger;
import com.zerotoheroes.mr.common.RdsRepository;
import com.zerotoheroes.mr.common.ReviewDao;
import com.zerotoheroes.mr.common.S3Dao;
import com.zerotoheroes.mr.common.SqsDao;
import com.zerotoheroes.mr.common.TriggerWatcherEvent;
import com.zerotoheroes.mr.reduce.ReduceEvent;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.util.List;

@Singleton
public class Watcher {

    // We assume the global timeout for the function will be 600 seconds
    private static final int TIMEOUT_LIMIT = 1000 * 500;
    // It the phase takes too long, cancel it for now
    private static final int MAX_ALLOWED_EXECUTION_TIME = 1000 * 60 * 60 * 2;
    private static final String RESULT_FOLDER = "result";

    private final ReviewDao reviewDao;
    private final S3Dao s3;
    private final SqsDao sqs;
    private final RdsRepository db;

    private Logger logger;

    @Inject
    public Watcher(ReviewDao reviewDao, S3Dao s3, SqsDao sqs, RdsRepository db) {
        this.reviewDao = reviewDao;
        this.s3 = s3;
        this.sqs = sqs;
        this.db = db;
    }

    public void setLogger(Logger logger) {
        this.logger = logger;
        this.reviewDao.setLogger(logger);
        this.s3.setLogger(logger);
        this.sqs.setLogger(logger);
    }

    public void handleRequest(TriggerWatcherEvent triggerEvent) {
        long start = System.currentTimeMillis();
        int numberOfReducers = triggerEvent.getExpectedNumberOfFiles();
        long nbFiles;
        while ((nbFiles = countOutputFiles(triggerEvent)) < numberOfReducers) {
            logger.log("Reducing completion progress: " + nbFiles + " / " + numberOfReducers);
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                logger.log("Thread sleep interrupted " + e.getMessage());
                e.printStackTrace();
            }
            if (System.currentTimeMillis() - start > TIMEOUT_LIMIT && System.currentTimeMillis() - start < MAX_ALLOWED_EXECUTION_TIME) {
                sqs.sendMessageToQueue(triggerEvent, System.getenv("SQS_REDUCER_WATCHER_URL"));
                logger.log("Sending new message to queue to continue the process");
                return;
            }
        }
        logger.log("Reducing phase done! Starting aggregation phase");
        startAggregationPhase(outputFileKeys(triggerEvent), triggerEvent.getJobRootFolder());
        logger.log("Aggregating phase trigger done");
        TriggerWatcherEvent newTriggerEvent = TriggerWatcherEvent.builder()
                .bucket(System.getenv("S3_BUCKET"))
                .folder(RESULT_FOLDER)
                .jobRootFolder(triggerEvent.getJobRootFolder())
                .expectedNumberOfFiles(1)
                .build();
        sqs.sendMessageToQueue(newTriggerEvent, System.getenv("SQS_AGGREGATOR_WATCHER_URL"));
        logger.log("Job's done! Passing the baton " + newTriggerEvent);
    }

    private ReduceEvent startAggregationPhase(List<String> outputFlieKeys, String jobRootFolder) {
        ReduceEvent aggregationEvent = buildAggregationEvent(outputFlieKeys, jobRootFolder);
        logger.log("Built SQS aggregation event to send: " + aggregationEvent);
        sqs.sendMessageToQueue(aggregationEvent, System.getenv("SQS_AGGREGATOR_TRIGGER_URL"));
        logger.log("Sent all SQS messages to reducers");
        return aggregationEvent;
    }

    private ReduceEvent buildAggregationEvent(List<String> outputFlieKeys, String jobRootFolder) {
        return ReduceEvent.builder()
                .bucket(System.getenv("S3_BUCKET"))
                .outputFolder(RESULT_FOLDER)
                .jobRootFolder(jobRootFolder)
                .fileKeys(outputFlieKeys)
                .build();
    }

    private long countOutputFiles(TriggerWatcherEvent event) {
        return db.countFilesCompleted(event.getJobRootFolder(), event.getFolder());
    }

    private List<String> outputFileKeys(TriggerWatcherEvent event) {
        return db.getFileKeys(event.getJobRootFolder(), event.getFolder());
//        return s3.getFileSummaries(event.getBucket(), event.getJobRootFolder() + "/" + event.getFolder());
    }
}

package com.zerotoheroes.mr.watcher.aggregator;

import com.zerotoheroes.mr.common.Logger;
import com.zerotoheroes.mr.common.RdsRepository;
import com.zerotoheroes.mr.common.ReviewDao;
import com.zerotoheroes.mr.common.S3Dao;
import com.zerotoheroes.mr.common.SqsDao;
import com.zerotoheroes.mr.common.TriggerWatcherEvent;

import javax.inject.Inject;
import javax.inject.Singleton;

@Singleton
public class Watcher {

    // We assume the global timeout for the function will be 600 seconds
    private static final int TIMEOUT_LIMIT = 1000 * 500;
    // It the phase takes too long, cancel it for now
    private static final int MAX_ALLOWED_EXECUTION_TIME = 1000 * 60 * 60 * 2;

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
        long nbFiles;
        while ((nbFiles = countOutputFiles(triggerEvent)) < 1) {
            logger.log("Aggregation completion progress: " + nbFiles + " / " + 1);
            try {
                Thread.sleep(2000);
            } catch (InterruptedException e) {
                logger.log("Thread sleep interrupted " + e.getMessage());
                e.printStackTrace();
            }
            if (System.currentTimeMillis() - start > TIMEOUT_LIMIT && System.currentTimeMillis() - start < MAX_ALLOWED_EXECUTION_TIME) {
                sqs.sendMessageToQueue(triggerEvent, System.getenv("SQS_AGGREGATOR_WATCHER_URL"));
                return;
            }
        }
        logger.log("Aggregation phase done! Should send an email here");
    }

    private long countOutputFiles(TriggerWatcherEvent event) {
        return db.countFilesCompleted(event.getJobRootFolder(), event.getFolder());
    }
}

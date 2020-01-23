package com.zerotoheroes.mr.reducer;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.zerotoheroes.mr.common.Logger;
import com.zerotoheroes.mr.common.RdsRepository;
import com.zerotoheroes.mr.common.ReviewDao;
import com.zerotoheroes.mr.common.S3Dao;
import com.zerotoheroes.mr.map.MapOutput;
import com.zerotoheroes.mr.reduce.ReduceEvent;
import com.zerotoheroes.mr.reduce.ReduceOutput;
import lombok.SneakyThrows;

import javax.inject.Inject;
import javax.inject.Singleton;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@Singleton
public class Reducer {

    private S3Dao s3;
    private ReviewDao reviewDao;
    private RdsRepository db;
    private ObjectMapper objectMapper;

    private Logger logger;

    @Inject
    public Reducer(S3Dao s3, ReviewDao reviewDao, RdsRepository db) {
        this.s3 = s3;
        this.reviewDao = reviewDao;
        this.db = db;
        this.objectMapper = new ObjectMapper();
    }

    public void setLogger(Logger logger) {
        this.logger = logger;
        this.s3.setLogger(logger);
        this.reviewDao.setLogger(logger);
        this.db.setLogger(logger);
    }

    public void handleRequest(List<ReduceEvent> reduceEvents) {
        logger.log("Ready to handle " + reduceEvents.size() + " events");
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
    }

    private ReduceOutput processReduceEvent(ReduceEvent reduceEvent) {
        logger.log("Processing reduce event " + reduceEvent);
        ReduceOutput reduce = reduceEvent.getFileKeys().stream()
                .map(fileKey -> this.loadFileContent(fileKey, reduceEvent.getBucket()))
                .map(this::toReduceOutput)
                .reduce(ReduceOutput.builder().output(Collections.emptyMap()).build(), this::mergeReduceEvents);
        logger.log("Processed event " + reduce);
        return reduce;
    }

    @SneakyThrows
    private MapOutput loadFileContent(String fileKey, String inputBucket) {
        String strMapOutput = s3.readContentAsString(inputBucket, fileKey);
        return objectMapper.readValue(strMapOutput, MapOutput.class);
    }

    private ReduceOutput toReduceOutput(MapOutput mapOutput) {
        return ReduceOutput.builder()
                .output(mapOutput.getOutput())
                .build();
    }

    private ReduceOutput mergeReduceEvents(ReduceOutput currentResult, ReduceOutput newResult) {
        Map<String, Integer> result = new HashMap<>(currentResult.getOutput());
        newResult.getOutput().forEach((key, value) -> result.merge(key, value, (v1, v2) -> v1 + v2));
        return ReduceOutput.builder()
                .output(result)
                .build();
    }
}

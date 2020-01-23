package com.zerotoheroes.mr.watcher.aggregator;


import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.SQSEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.google.inject.Injector;
import com.zerotoheroes.mr.common.TriggerWatcherEvent;
import com.zerotoheroes.mr.impl.ImplementationModule;
import lombok.SneakyThrows;

import java.text.SimpleDateFormat;

public class WatcherFunction implements RequestHandler<SQSEvent, Object> {

    private static Injector injector;
    private static ObjectMapper objectMapper;

    private Watcher watcher;

    static {
        injector = Guice.createInjector(new ImplementationModule());
        objectMapper = new ObjectMapper();
        objectMapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS"));
    }

    @Override
    public Object handleRequest(SQSEvent event, Context context) {
        context.getLogger().log("Received request");
        TriggerWatcherEvent triggerEvent = event.getRecords().stream()
                .map(SQSEvent.SQSMessage::getBody)
                .map(this::readEvent)
                .findFirst()
                .get();
        context.getLogger().log("Handling triggerEvent " + triggerEvent);
        watcher = injector.getInstance(Watcher.class);
        watcher.setLogger((msg) -> context.getLogger().log(msg));
        watcher.handleRequest(triggerEvent);
        context.getLogger().log("Handling request done");
        return "Hopla";
    }

    @SneakyThrows
    private TriggerWatcherEvent readEvent(String body) {
        return objectMapper.readValue(body, TriggerWatcherEvent.class);
    }
}
package com.zerotoheroes.mr.reducer;


import com.amazonaws.services.lambda.runtime.Context;
import com.amazonaws.services.lambda.runtime.RequestHandler;
import com.amazonaws.services.lambda.runtime.events.SQSEvent;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.google.inject.Guice;
import com.google.inject.Injector;
import com.zerotoheroes.mr.impl.ImplementationModule;
import com.zerotoheroes.mr.reduce.ReduceEvent;
import lombok.SneakyThrows;

import java.text.SimpleDateFormat;
import java.util.List;
import java.util.stream.Collectors;

public class ReducerFunction implements RequestHandler<SQSEvent, Object> {

    private static Injector injector;
    private static ObjectMapper objectMapper;

    private Reducer reducer;

    static {
        injector = Guice.createInjector(new ImplementationModule());
        objectMapper = new ObjectMapper();
        objectMapper.setDateFormat(new SimpleDateFormat("yyyy-MM-dd HH:mm:ss.SSS"));
    }

    @Override
    public Object handleRequest(SQSEvent event, Context context) {
        context.getLogger().log("Received reducer request");
        List<ReduceEvent> reduceEvents = event.getRecords().stream()
                .map(SQSEvent.SQSMessage::getBody)
                .map(this::readReduceEvent)
                .collect(Collectors.toList());
        context.getLogger().log("Handling " + reduceEvents.size() + " events " );
        reducer = injector.getInstance(Reducer.class);
        context.getLogger().log("Reducer created " + reducer);
        reducer.setLogger((msg) -> context.getLogger().log(msg));
        reducer.handleRequest(reduceEvents);
        context.getLogger().log("Handling request done");
        return "Hopla";
    }

    @SneakyThrows
    private ReduceEvent readReduceEvent(String body) {
        return objectMapper.readValue(body, ReduceEvent.class);
    }
}
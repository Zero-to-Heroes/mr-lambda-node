package com.zerotoheroes.mr.impl;

import com.google.inject.AbstractModule;
import com.zerotoheroes.mr.impl.countingreviews.CountingReviewsQueryImplementation;
import com.zerotoheroes.mr.impl.countingreviews.GamesPlayedExtractor;

public class ImplementationModule extends AbstractModule {

    @Override
    public void configure() {
        bind(QueryImplementation.class).to(CountingReviewsQueryImplementation.class);
        bind(DataExtraction.class).to(GamesPlayedExtractor.class);
    }
}

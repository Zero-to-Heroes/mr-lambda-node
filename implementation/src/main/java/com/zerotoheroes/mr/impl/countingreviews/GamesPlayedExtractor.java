package com.zerotoheroes.mr.impl.countingreviews;

import com.zerotoheroes.hsgameentities.replaydata.HearthstoneReplay;
import com.zerotoheroes.mr.impl.DataExtraction;

import javax.inject.Singleton;

@Singleton
public class GamesPlayedExtractor implements DataExtraction {

    @Override
    public int processReplay(HearthstoneReplay replay) {
        return 1;
    }
}

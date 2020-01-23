package com.zerotoheroes.mr.impl.countingreviews;

import com.zerotoheroes.mr.impl.QueryImplementation;
import org.springframework.data.mongodb.core.query.Criteria;
import org.springframework.data.mongodb.core.query.Query;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.temporal.ChronoUnit;
import java.util.Date;

import static org.springframework.data.mongodb.core.query.Criteria.where;
import static org.springframework.data.mongodb.core.query.Query.query;

public class CountingReviewsQueryImplementation implements QueryImplementation {

    @Override
    public Query reviewIdsSelectorQuery() {
        LocalDateTime startDate = LocalDateTime.now().minus(1, ChronoUnit.DAYS);
        Instant instant = startDate.atZone(ZoneId.systemDefault()).toInstant();
        Date date = Date.from(instant);
        return query(new Criteria()
                .andOperator(
                        where("creationDate").gte(date),
                        where("key").ne(null),
                        where("authorId").ne(null)));
    }
}

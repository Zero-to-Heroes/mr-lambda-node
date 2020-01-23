package com.zerotoheroes.mr.common;

import com.mongodb.MongoClient;
import com.zerotoheroes.mr.impl.QueryImplementation;
import lombok.Setter;
import org.json.JSONObject;
import org.springframework.data.mongodb.core.MongoTemplate;
import org.springframework.data.mongodb.core.query.Field;
import org.springframework.data.mongodb.core.query.Query;

import javax.inject.Inject;
import java.util.List;
import java.util.stream.Collectors;

public class ReviewDao {

    private final MongoTemplate mongoTemplate;
    private final QueryImplementation implementation;

    @Setter
    private Logger logger;

    @Inject
    public ReviewDao(SecretManager secretManager, QueryImplementation implementation) {
        JSONObject connectionInfo = secretManager.getMongoDbConnectionInfo();
        this.mongoTemplate = new MongoTemplate(
                new MongoClient(connectionInfo.getString("url"), connectionInfo.getInt("port")),
                connectionInfo.getString("database"));
        this.implementation = implementation;
    }

    public List<String> loadReviews() {
        Query query = implementation.reviewIdsSelectorQuery();
//        query.addCriteria(new Criteria().andOperator(where("id").ne(null)));
        Field fields = query.fields();
        fields.include("id");
        List<MiniReview> reviewIds = mongoTemplate.find(query, MiniReview.class, "review");
        logger.log("Will perform MR on " + reviewIds.size() + " reviews");
        return reviewIds.stream().map(MiniReview::getId).collect(Collectors.toList());
    }

    public MiniReview getReview(String reviewId) {
        return mongoTemplate.findById(reviewId, MiniReview.class, "review");
    }
}

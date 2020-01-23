package com.zerotoheroes.mr.impl;

import org.springframework.data.mongodb.core.query.Query;

public interface QueryImplementation {
    Query reviewIdsSelectorQuery();
}

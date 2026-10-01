-- Single local development store per database; fingerprint contains no key material.
CREATE TABLE local_storage_binding (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), root_hash text NOT NULL, key_fingerprint text NOT NULL
);

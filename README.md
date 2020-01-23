mvn clean package \
  && aws cloudformation package --template-file sam.yaml --output-template-file output-sam.yaml --s3-bucket com.zerotoheroes.artifact \
  && aws cloudformation deploy --template-file output-sam.yaml --stack-name MRLambdaStack --capabilities CAPABILITY_IAM

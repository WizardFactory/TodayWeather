#!/bin/sh
git subtree split --prefix=server -b release-server
git checkout release-server
aws s3 cp s3://tw-config/config.js ./config/config.js --region ap-northeast-2

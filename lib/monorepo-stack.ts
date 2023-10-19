import * as cdk from 'aws-cdk-lib';
import {CfnOutput, Duration, RemovalPolicy} from 'aws-cdk-lib';
import {Construct} from 'constructs';
import {BlockPublicAccess, Bucket, BucketAccessControl, ObjectOwnership} from 'aws-cdk-lib/aws-s3';
import {BucketDeployment, Source} from 'aws-cdk-lib/aws-s3-deployment';
import {Architecture, Code, Function, Runtime} from 'aws-cdk-lib/aws-lambda';
import {LambdaIntegration, RestApi} from 'aws-cdk-lib/aws-apigateway';
import {Certificate, DnsValidatedCertificate, ValidationMethod} from 'aws-cdk-lib/aws-certificatemanager';
import {ARecord, HostedZone, RecordTarget} from 'aws-cdk-lib/aws-route53';
import {
    AllowedMethods,
    Distribution,
    OriginAccessIdentity,
    SecurityPolicyProtocol,
    ViewerProtocolPolicy
} from 'aws-cdk-lib/aws-cloudfront';
import {S3Origin} from 'aws-cdk-lib/aws-cloudfront-origins';
import {CloudFrontTarget} from 'aws-cdk-lib/aws-route53-targets';

export interface ServiceProperties extends cdk.StackProps {
    readonly domainName: string;
    readonly hostedZoneId: string;
    readonly certArnUsEast1: string;
}

export class MonorepoStack extends cdk.Stack {
    constructor(readonly scope: Construct,
                readonly id: string,
                readonly properties: ServiceProperties) {
        super(scope, id, properties);

        // had to explicit set blockPublicAccess to be able to deploy bucket
        const uiBucket = new Bucket(this, 'UiBucket', {
            bucketName: 'd2c-cdk-workshop-monorepo-ui-malte',
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            blockPublicAccess: {
                blockPublicAcls: false,
                blockPublicPolicy: false,
                restrictPublicBuckets: false,
                ignorePublicAcls: false
            },
            websiteIndexDocument: 'index.html',
            websiteErrorDocument: 'index.html',
            publicReadAccess: true,
        });

        // had to use fromHostedZoneAttributes because i god error
        // otherwise when deploying with fromHostedZoneId
        const hostedZone = HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
            zoneName: properties.domainName,
            hostedZoneId: properties.hostedZoneId
        });

        // ACM certificates that are used with CloudFront -- or higher-level constructs which rely on CloudFront
        // -- must be in the us-east-1 region. CloudFormation allows you to create a Stack with a CloudFront distribution in any region.
        // In order to create an ACM certificate in us-east-1 and reference it in a CloudFront distribution is a different region,
        // it is recommended to perform a multi stack deployment.

        // const certificate = new Certificate(this, 'Certificate', {
        //     certificateName: 'my-cdk-certificate',
        //     domainName: properties.domainName,
        //     validation: {
        //         method: ValidationMethod.DNS,
        //         props: {
        //             hostedZone: hostedZone
        //         }
        //     }
        // });

        const usEast1Cert = Certificate.fromCertificateArn(this, 'CertificateImportedFromUsEast1', properties.certArnUsEast1);

        const cloudfrontOAI = new OriginAccessIdentity(this, 'cloudfront-OAI', {
            comment: `OAI for ${id}`
        });

        const websiteDistribution = new Distribution(this, 'SiteDistribution', {
            certificate: usEast1Cert,
            defaultRootObject: 'index.html',
            domainNames: [properties.domainName],
            minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,
            errorResponses: [
                {
                    httpStatus: 403,
                    responseHttpStatus: 403,
                    responsePagePath: '/error.html',
                    ttl: Duration.minutes(1),
                }
            ],
            defaultBehavior: {
                origin: new S3Origin(uiBucket, {originAccessIdentity: cloudfrontOAI}),
                compress: true,
                allowedMethods: AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            }
        });

        // cant be created when already existing
        // had to delete old version in my case
        new ARecord(this, 'SiteAliasRecord', {
            recordName: properties.domainName,
            target: RecordTarget.fromAlias(new CloudFrontTarget(websiteDistribution)),
            zone: hostedZone
        });

        new BucketDeployment(this, 'UiDeployment', {
            destinationBucket: uiBucket,
            sources: [Source.asset('./ui')],
        });

        const testFunction = new Function(this, 'TestFunction', {
            architecture: Architecture.ARM_64,
            runtime: Runtime.NODEJS_18_X,
            memorySize: 512,
            code: Code.fromAsset('./service'),
            handler: 'index.test'
        });

        const api = new RestApi(this, 'RestApi', {});
        api.root.addMethod('GET', new LambdaIntegration(testFunction, {
            proxy: true
        }));

        new CfnOutput(this, 'UiBucketDomainOutput', {
            exportName: 'ui-bucket:domain-name',
            value: uiBucket.bucketWebsiteDomainName,
            description: 'The website domain name for the UI bucket'
        });
    }
}

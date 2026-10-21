# Field-encryption keys: moving to AWS KMS

PII seals sensitive fields with AES-256-GCM: documents, email bodies, AI partner keys, signing settings and vault objects. Today the key
comes from `LOCAL_KEY_SECRET`, a Railway variable. This change keeps that key only in AWS KMS: Railway holds the data key encrypted
("wrapped"), and the server asks KMS to unwrap it once at startup. Data sealed before the switch keeps opening with `LOCAL_KEY_SECRET`,
so nothing is re-encrypted on the day. SOC 2 readiness gap 12; code review finding M-03.

## Switch it on (one country at a time; Canada shown)

1. **AWS, Key Management Service:** create a symmetric key in the same region as that country's vault bucket.
   - Alias: `alias/pii-ca-fields`
   - Key administrator: your admin user only
2. **IAM:** give the user whose keys are already on Railway (the vault user) `kms:Decrypt` on that key only. Use a key policy or an inline policy with the key's ARN.
3. **Make the wrapped data key**, once, with the AWS CLI (owner's machine or CloudShell):
   ```
   aws kms generate-data-key --key-id alias/pii-ca-fields --key-spec AES_256 --region <region> --query CiphertextBlob --output text
   ```
   Copy the printed text. It is safe to store: without KMS it cannot be read.
4. **Railway, pii-ca api service:** set these variables and keep `LOCAL_KEY_SECRET` as it is:
   - `KMS_WRAPPED_DATA_KEY` = the text from step 3
   - `KMS_REGION` = the key's region
   - `KMS_KEY_ARN` = the key's ARN
5. **Deploy.** New data is sealed under `kms-1`; older data opens with the local key. If KMS cannot be reached at startup, the server
   does not start rather than running without its key. The server log names the error.
6. **Repeat for the US** with `alias/pii-us-fields` in the US vault region.

## Rules

- **Never delete the KMS key, or `LOCAL_KEY_SECRET`,** while data sealed with it exists. Deleting either makes that data unreadable, backups included.
- **To rotate:**
  1. Make a new wrapped data key (step 3).
  2. Set `KMS_KEY_ID_LABEL` to a new label (`kms-2`).
  3. Set `KMS_WRAPPED_DATA_KEY` to the new key and deploy.

  A re-encryption job (not built yet) is needed before an old key can be retired.
- **Record each switch and rotation in the SOC 2 evidence:** date, who did it, and the key ARN.

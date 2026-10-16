// Every brain provider declares how its vendor handles request data (safety.md §1, Req 1.1,
// 1.3). An adapter records the vendor's zero-retention and no-training settings here.

export type DataHandlingDeclaration = Readonly<{
  /** True if the vendor keeps any request data (audio, text) after answering. */
  vendorRetainsRequestData: boolean;
  /** True if the vendor may use request data to train its models. */
  vendorMayTrainOnRequestData: boolean;
}>;

/** No retention and no training: the only declaration the Provider_Gate accepts (Req 1.3). */
export const NO_RETENTION_NO_TRAINING: DataHandlingDeclaration = Object.freeze({
  vendorRetainsRequestData: false,
  vendorMayTrainOnRequestData: false,
});

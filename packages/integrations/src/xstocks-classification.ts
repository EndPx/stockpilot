/** Classification evidence overlays, NOT a discovery whitelist or execution approval.
 * Reviewed 2026-09-23; must match mint, issuer ID and both ISINs from the live catalog.
 */
export const XSTOCKS_CLASSIFICATION_EVIDENCE = [
  { mint: "XsbEhLAtcf6HdfpFZ5xEMdqW8nfAvcsP5bdudRLJzJp", issuerId: "9e43a778-fdc8-44f1-87de-f2e7420bb7f7", productIsin: "CH1436219187", underlyingIsin: "US0378331005", source: "https://assets.backed.fi/products/apple-xstock" },
  { mint: "Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh", issuerId: "0997ed45-6a34-4f26-be92-28d8e0f9f28a", productIsin: "CH1436219195", underlyingIsin: "US67066G1040", source: "https://assets.backed.fi/products/nvidia-xstock" },
  { mint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB", issuerId: "96f43a87-976b-4076-ac84-394966c32a90", productIsin: "CH1436219252", underlyingIsin: "US88160R1014", source: "https://assets.backed.fi/products/tesla-xstock" },
] as const;

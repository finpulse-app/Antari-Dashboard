# Provisional customer sales allocations

Owner-approved location estimates are stored separately from imported customer sales. Every allocation references a specific source report row and a listed customer. A deferred database constraint requires the active allocations to equal the original amount exactly; the entire group can be disabled and restored from Data quality. Original source rows and channel totals are retained. Future report rows are not automatically allocated.

The mapped-sales view projects the allocation into customer rankings, ZIP revenue, and customer histories. It flags allocated rows and preserves the source invoice count separately. Location invoice counts are unknown, rather than invented or displayed as zero. Payments and receivables use their existing mappings and are not split. Pagination orders split rows by source ID and mapped customer.

Data quality lists the split, its reason, and its status. Customer details, directory exports, territory insights, and the owner brief identify estimated location figures. Ordinary name-mapping changes are blocked for names with an active split until it is disabled, preventing a hidden allocation from overriding a later mapping decision.

Allocation rows are owner-readable. Clients can only toggle their active status; amounts and destinations require an explicit authorized administrative change. RLS applies to the allocation table and the views run with security invoker. The source total is also checked when the original sale is updated.

Validation: 33 automated checks pass. Database rollback checks cover conservation of revenue, unassigned invoice counts, reversible group toggles, rejection of partial allocations, and owner-only access. Customer-specific allocation instructions and financial amounts are kept in the database, outside the public source repository.

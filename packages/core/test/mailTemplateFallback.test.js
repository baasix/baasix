import { destroyAllTablesInDB, startServerForTesting, MailService, ItemsService } from "../baasix";
import { beforeAll, afterAll, test, expect, describe } from "@jest/globals";

// An upgraded install has no baasix_Template row for template types added after
// its DB was first seeded (template seeding only runs on an empty database).
// MailService must then fall back to its hardcoded default — never to the
// empty-content last resort. Simulate the upgrade by deleting the DB rows.
async function deleteTemplateRows(type) {
    const service = new ItemsService("baasix_Template", { accountability: undefined });
    const { data } = await service.readByQuery({ filter: { type: { eq: type } } });
    for (const row of data || []) {
        await service.deleteOne(row.id);
    }
}

beforeAll(async () => {
    await destroyAllTablesInDB();
    await startServerForTesting();
    await deleteTemplateRows("passwordResetCode");
    await deleteTemplateRows("magicLinkCode");
}, 60000);

afterAll(async () => {
    await destroyAllTablesInDB();
});

describe("MailService hardcoded fallback for code templates (upgraded installs)", () => {
    test("passwordResetCode renders the code without a DB template row", async () => {
        const { subject, html } = await MailService.renderTemplateWithDB("passwordResetCode", {
            code: "QK7M2XWP",
            name: "Vivek",
            project_name: "TestProject",
        });

        expect(html).toContain("QK7M2XWP");
        expect(html).toContain("Vivek");
        expect(subject.toLowerCase()).toContain("password");
    });

    test("magicLinkCode renders the code without a DB template row (parity control)", async () => {
        const { html } = await MailService.renderTemplateWithDB("magicLinkCode", {
            code: "ABCD2345",
            name: "Vivek",
            project_name: "TestProject",
        });

        expect(html).toContain("ABCD2345");
    });

    test("passwordResetCode is listed in the default template types (settings UI picker)", () => {
        const types = MailService.getDefaultTemplateTypes().map((t) => t.type);
        expect(types).toContain("passwordResetCode");
        expect(types).toContain("magicLinkCode");
    });
});

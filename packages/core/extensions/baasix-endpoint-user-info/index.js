// Import from the installed package
import { APIError, MailService } from "@baasix/baasix";

const registerEndpoint = (app, context) => {

  app.get("/sendmail", async (req, res) => {
    await MailService.sendMail({
      to: "vivekpalanisamy@gmail.com",
      subject: "Test Email from Baasix",
      templateName:"test"
    });

    res.json({ message: "Email sent successfully" });

  });

  app.get("/user-info", async (req, res, next) => {
    try {
      // Check if user is authenticated
      if (!req.accountability || !req.accountability.user) {
        throw new APIError("Unauthorized", 401);
      }

      const { user, role } = req.accountability;

      const userDetails = {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
      };

      const roleDetails = {
        id: role.id,
        name: role.name,
      };

      res.json({
        user: userDetails,
        role: roleDetails,
      });
    } catch (error) {
      next(error);
    }
  });
};

export default {
  id: "user-info",
  handler: registerEndpoint,
};

import env from "../utils/env.js";
import nodemailer from "nodemailer";
import { Liquid } from "liquidjs";
import fs from "fs";
import settingsService from "./SettingsService.js";
import type { MailOptions, SenderConfig, TenantTransporter } from '../types/index.js';
import { getBaasixPath, getProjectPath } from "../utils/dirname.js";

class MailService {
  private senders: Record<string, SenderConfig> = {};
  private tenantTransporters: Map<string | number, TenantTransporter> = new Map();
  private defaultSender: string | null = null;
  private engine: Liquid;
  private defaultLayoutTemplate: string = "";
  private defaultLayoutTemplatePath: string;
  private defaultLogoPath: string;
  private customLogoPath: string;
  private logoDataUri: string | null = null;
  private initialized: boolean = false;

  constructor() {
    this.engine = new Liquid();
    // Default layout template bundled with package
    this.defaultLayoutTemplatePath = getBaasixPath("templates/mails/default.liquid");
    this.defaultLogoPath = getBaasixPath("templates/logo/logo.png");
    // Custom logo in user's project directory
    this.customLogoPath = getProjectPath("extensions/baasix-templates/logo/logo.png");
    // Note: initialize() is now called explicitly from app.ts, not in constructor
  }

  async initialize(): Promise<void> {
    // Prevent double initialization
    if (this.initialized) {
      return;
    }
    this.initialized = true;
    const sendersEnabled = this.getSendersEnabled();

    if (sendersEnabled.length === 0) {
      console.warn("No mail senders enabled. Check your MAIL_SENDERS_ENABLED environment variable.");
      return;
    }

    for (const sender of sendersEnabled) {
      await this.initializeSender(sender);
    }

    this.defaultSender = env.get("MAIL_DEFAULT_SENDER") || sendersEnabled[0];

    this.loadDefaultLayoutTemplate();
    this.loadLogo();
    console.info("Mail Service Initialization Complete");
    console.info("Default Sender:", this.defaultSender);
    console.info("------------------------------");
  }

  getSendersEnabled(): string[] {
    const sendersEnabledString = env.get("MAIL_SENDERS_ENABLED");

    console.info("Senders Enabled:", sendersEnabledString);

    if (!sendersEnabledString) {
      console.warn("MAIL_SENDERS_ENABLED is not defined in the environment variables.");
      return [];
    }
    return sendersEnabledString
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  async initializeSender(sender: string): Promise<void> {
    const senderUpper = sender.toUpperCase();
    const host = env.get(`${senderUpper}_SMTP_HOST`);
    const port = env.get(`${senderUpper}_SMTP_PORT`);
    const secure = env.get(`${senderUpper}_SMTP_SECURE`) === "true";
    const user = env.get(`${senderUpper}_SMTP_USER`);
    const pass = env.get(`${senderUpper}_SMTP_PASS`);
    const from = env.get(`${senderUpper}_FROM_ADDRESS`);

    if (!host || !port || !user || !pass || !from) {
      console.warn(`Incomplete configuration for sender ${sender}. Skipping.`);
      return;
    }

    this.senders[sender] = {
      transporter: nodemailer.createTransport({
        host,
        port: parseInt(port),
        secure,
        auth: { user, pass },
      }),
      from,
    };

    console.info(`Initialized mail sender: ${sender}`);
  }

  loadDefaultLayoutTemplate(): void {
    try {
      this.defaultLayoutTemplate = fs.readFileSync(this.defaultLayoutTemplatePath, "utf8");
      console.log("Default layout template loaded successfully");
    } catch (error) {
      console.error("Error loading default layout template:", error);
      this.defaultLayoutTemplate = "<html><body>{{content}}</body></html>"; // Fallback template
    }
  }

  loadLogo(): void {
    try {
      const logoPath = fs.existsSync(this.customLogoPath) ? this.customLogoPath : this.defaultLogoPath;
      const logoBuffer = fs.readFileSync(logoPath);
      // Convert to base64 data URI for embedding directly in img src
      const base64 = logoBuffer.toString('base64');
      this.logoDataUri = `data:image/png;base64,${base64}`;

      console.info("Logo loaded successfully as data URI");
    } catch (error) {
      console.error("Error loading logo:", error);
      this.logoDataUri = null;
    }
  }

  /**
   * Get template from database with tenant-specific override support
   */
  async getTemplateFromDB(templateName: string, tenantId?: string | number): Promise<{ subject: string; body: string } | null> {
    try {
      // Import ItemsService dynamically to avoid circular dependency
      const { default: ItemsService } = await import('./ItemsService.js');
      const templateService = new ItemsService('baasix_Template', {
        accountability: undefined, // System operation, bypass permissions
      });

      // First try to get tenant-specific template
      if (tenantId) {
        const tenantResult = await templateService.readByQuery({
          filter: {
            type: { eq: templateName },
            tenant_Id: { eq: tenantId },
            isActive: { eq: true }
          },
          limit: 1
        }, true); // bypassPermissions = true

        const tenantTemplates = tenantResult.data || [];
        if (tenantTemplates.length > 0) {
          return {
            subject: tenantTemplates[0].subject,
            body: tenantTemplates[0].body
          };
        }
      }

      // Fall back to default template (tenant_Id is NULL)
      const defaultResult = await templateService.readByQuery({
        filter: {
          type: { eq: templateName },
          tenant_Id: { isNull: true },
          isActive: { eq: true }
        },
        limit: 1
      }, true); // bypassPermissions = true

      const defaultTemplates = defaultResult.data || [];
      if (defaultTemplates.length > 0) {
        return {
          subject: defaultTemplates[0].subject,
          body: defaultTemplates[0].body
        };
      }

      return null;
    } catch (error) {
      console.error(`Error fetching template from database: ${templateName}`, error);
      return null;
    }
  }

  /**
   * Wrap body content in a minimal HTML document structure if it's not already a complete document.
   */
  private wrapInHtmlDocument(body: string, subject: string): string {
    const trimmedBody = body.trim();
    
    // Check if already a complete HTML document
    const hasDoctype = trimmedBody.toLowerCase().startsWith('<!doctype');
    const hasHtmlTag = /<html[\s>]/i.test(trimmedBody);
    
    if (hasDoctype || hasHtmlTag) {
      // Already a complete document
      return body;
    }
    
    // Extract <style> tags to put in <head>
    const styleRegex = /<style[^>]*>[\s\S]*?<\/style>/gi;
    const styleMatches = trimmedBody.match(styleRegex) || [];
    const stylesForHead = styleMatches.join('\n');
    const contentWithoutStyles = trimmedBody.replace(styleRegex, '').trim();
    
    // Check if content has <body> tag anywhere
    const hasBodyTag = /<body[\s>]/i.test(contentWithoutStyles);
    
    if (hasBodyTag) {
      // Has body tag - wrap with html structure, put styles in head
      return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(subject)}</title>
    ${stylesForHead}
</head>
${contentWithoutStyles}
</html>`;
    }
    
    // No body tag - wrap content in body, put styles in head
    return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${this.escapeHtml(subject)}</title>
    ${stylesForHead}
</head>
<body style="margin: 0; padding: 0;">
${contentWithoutStyles}
</body>
</html>`;
  }

  /**
   * Escape HTML special characters for safe insertion into HTML attributes/content
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  /**
   * Render template from database
   * First tries database, then falls back to hardcoded default templates
   * 
   * NOTE: Templates are wrapped in the default layout only if they don't have HTML/body structure.
   * Templates with full HTML structure have full control over their layout.
   */
  async renderTemplateWithDB(templateName: string, context: Record<string, any>, tenantId?: string | number): Promise<{ subject: string; html: string }> {
    // Try to get template from database first
    const dbTemplate = await this.getTemplateFromDB(templateName, tenantId);
    
    if (dbTemplate) {
      // Render both subject and body with Liquid
      const renderedSubject = await this.engine.parseAndRender(dbTemplate.subject, context);
      const renderedBody = await this.engine.parseAndRender(dbTemplate.body, context);
      
      // Wrap with layout if template doesn't have HTML/body structure
      const html = await this.wrapWithLayoutIfNeeded(renderedBody, renderedSubject, context);
      
      return {
        subject: renderedSubject,
        html
      };
    }

    // Fall back to hardcoded default templates
    const defaultTemplate = this.getDefaultTemplateContent(templateName);
    if (defaultTemplate) {
      const renderedSubject = await this.engine.parseAndRender(defaultTemplate.subject, context);
      const renderedBody = await this.engine.parseAndRender(defaultTemplate.body, context);
      
      // Check if template already has full HTML structure
      const html = this.wrapWithLayoutIfNeeded(renderedBody, renderedSubject, context);
      
      return {
        subject: renderedSubject,
        html: await html
      };
    }

    // Last resort fallback
    console.warn(`No template found for: ${templateName}, using basic template`);
    const html = await this.engine.parseAndRender(this.defaultLayoutTemplate, { ...context, content: context.content || '' });
    
    return {
      subject: context.subject || '',
      html
    };
  }

  /**
   * Wrap content with default layout template if it doesn't already have HTML/body structure
   */
  private async wrapWithLayoutIfNeeded(body: string, subject: string, context: Record<string, any>): Promise<string> {
    const trimmedBody = body.trim();
    
    // Check if already has HTML structure (html tag, body tag, or doctype)
    const hasDoctype = trimmedBody.toLowerCase().startsWith('<!doctype');
    const hasHtmlTag = /<html[\s>]/i.test(trimmedBody);
    const hasBodyTag = /<body[\s>]/i.test(trimmedBody);
    
    if (hasDoctype || hasHtmlTag || hasBodyTag) {
      // Already has structure - just wrap in minimal HTML document if needed
      return this.wrapInHtmlDocument(body, subject);
    }
    
    // No HTML structure - wrap in default layout template
    const wrappedHtml = await this.engine.parseAndRender(this.defaultLayoutTemplate, { ...context, content: body });
    return wrappedHtml;
  }

  async renderTemplate(templateName: string, context: Record<string, any>): Promise<string> {
    const defaultTemplate = this.getDefaultTemplateContent(templateName);
    if (defaultTemplate) {
      const renderedBody = await this.engine.parseAndRender(defaultTemplate.body, context);
      return this.wrapWithLayoutIfNeeded(renderedBody, context.subject || '', context);
    }
    return this.engine.parseAndRender(this.defaultLayoutTemplate, context);
  }

  /**
   * Get default template content for a given type
   * These are the built-in templates that are seeded into the database
   */
  getDefaultTemplateContent(templateType: string): { subject: string; body: string; description: string } | null {
    // Styled email wrapper matching default.liquid design
    const styledWrapper = (content: string, buttonHtml?: string) => `
<body style="font-family: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif; font-size: 16px; line-height: 1.6; color: #333; background-color: #f8f8f8; margin: 0; padding: 20px;">
    <div style="max-width: 600px; margin: 0 auto; background-color: #fff; border: 1px solid #f0f0f0; border-radius: 5px; box-shadow: 0px 0px 10px 8px #e0e0e0;">
        <header style="text-align: center; padding: 20px; background-color: {{ project_color | default: '#0066cc' }}; border-radius: 5px 5px 0 0;">
            {% if logo_url %}<img src="{{ logo_url }}" alt="{{ project_name }}" style="max-width: 200px;">{% else %}<h1 style="color: #fff; margin: 0; font-size: 24px;">{{ project_name }}</h1>{% endif %}
        </header>
        <div style="padding: 30px;">
            ${content}
            ${buttonHtml || ''}
        </div>
        <footer style="text-align: center; padding: 20px; font-size: 12px; color: #888; border-top: 1px solid #f0f0f0;">
            © {{ "now" | date: "%Y" }} {{ project_name }}. All rights reserved.
        </footer>
    </div>
</body>`;

    const buttonStyle = 'background-color: {{ project_color | default: "#0066cc" }}; color: white; padding: 14px 28px; text-decoration: none; border-radius: 6px; display: inline-block; font-weight: 600;';

    const defaultTemplates: Record<string, { subject: string; body: string; description: string }> = {
      inviteNewUser: {
        subject: "You've been invited to join {{ tenant }}",
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Welcome!</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Click the button below to accept your invitation and create your account:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="${buttonStyle}">Accept Invitation</a>
</p>
<p style="font-size: 14px; color: #666;"><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p style="font-size: 14px; color: #888;">If you didn't expect this invitation, you can safely ignore this email.</p>`
        ),
        description: 'Template for inviting new users who do not have an account yet'
      },
      inviteExistingUser: {
        subject: "You've been invited to join {{ tenant }}",
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">New Invitation</h2>
<p>Hi,</p>
<p>You've been invited by <strong>{{ inviterName }}</strong> to join <strong>{{ tenant }}</strong>.</p>
<p>Since you already have an account, click the button below to accept the invitation:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ inviteLink }}" style="${buttonStyle}">Accept Invitation</a>
</p>
<p style="font-size: 14px; color: #666;"><strong>Note:</strong> This invitation will expire on {{ expirationDate }}.</p>
<p style="font-size: 14px; color: #888;">If you didn't expect this invitation, you can safely ignore this email.</p>`
        ),
        description: 'Template for inviting existing users to a new tenant'
      },
      magicLinkUrl: {
        subject: 'Sign in to {{ project_name }}',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Sign In Request</h2>
<p>Hi {{ name }},</p>
<p>Click the button below to sign in to your account:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ magicLinkUrl }}" style="${buttonStyle}">Sign In</a>
</p>
<p style="font-size: 14px; color: #666;">This link will expire in 15 minutes for security purposes.</p>
<p style="font-size: 14px; color: #888;">If you didn't request this sign-in link, you can safely ignore this email.</p>`
        ),
        description: 'Template for magic link URL authentication'
      },
      magicLinkCode: {
        subject: 'Your sign in code for {{ project_name }}',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Sign In Code</h2>
<p>Hi {{ name }},</p>
<p>Use the following code to sign in to your account:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <span style="background-color: #f5f5f5; padding: 16px 32px; font-size: 28px; font-family: monospace; letter-spacing: 6px; border-radius: 8px; display: inline-block; border: 2px solid #e0e0e0;">{{ code }}</span>
</p>
<p style="font-size: 14px; color: #666;">This code will expire in 15 minutes for security purposes.</p>
<p style="font-size: 14px; color: #888;">If you didn't request this code, you can safely ignore this email.</p>`
        ),
        description: 'Template for magic link code authentication'
      },
      passwordReset: {
        subject: 'Reset your password for {{ project_name }}',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Password Reset</h2>
<p>Hi {{ name }},</p>
<p>We received a request to reset your password. Click the button below to choose a new password:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ resetUrl }}" style="${buttonStyle}">Reset Password</a>
</p>
<p style="font-size: 14px; color: #666;">This link will expire in 1 hour for security purposes.</p>
<p style="font-size: 14px; color: #888;">If you didn't request a password reset, you can safely ignore this email. Your password will remain unchanged.</p>`
        ),
        description: 'Template for password reset emails'
      },
      emailVerification: {
        subject: 'Verify your email for {{ project_name }}',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Email Verification</h2>
<p>Hi {{ name }},</p>
<p>Please verify your email address by clicking the button below:</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ verifyUrl }}" style="${buttonStyle}">Verify Email</a>
</p>
<p style="font-size: 14px; color: #666;">This link will expire in 24 hours.</p>
<p style="font-size: 14px; color: #888;">If you didn't create an account, you can safely ignore this email.</p>`
        ),
        description: 'Template for email verification'
      },
      welcome: {
        subject: 'Welcome to {{ project_name }}!',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">Welcome!</h2>
<p>Hi {{ name }},</p>
<p>Thank you for joining <strong>{{ project_name }}</strong>! We're excited to have you on board.</p>
<p>Your account has been successfully created and you're ready to get started.</p>`,
          `<p style="text-align: center; margin: 30px 0;">
  <a href="{{ loginUrl }}" style="${buttonStyle}">Get Started</a>
</p>
<p style="font-size: 14px; color: #888;">If you have any questions, feel free to reach out to our support team.</p>`
        ),
        description: 'Template for welcome emails to new users'
      },
      notification: {
        subject: '{{ notification_title }}',
        body: styledWrapper(
          `<h2 style="color: #333; margin: 0 0 20px 0;">{{ notification_title }}</h2>
<p>Hi {{ name }},</p>
<div style="margin: 20px 0;">{{ notification_message }}</div>`,
          `{% if action_url %}
<p style="text-align: center; margin: 30px 0;">
  <a href="{{ action_url }}" style="${buttonStyle}">{{ action_text | default: 'View Details' }}</a>
</p>
{% endif %}`
        ),
        description: 'Generic notification template'
      }
    };

    return defaultTemplates[templateType] || null;
  }

  /**
   * Get all available default template types
   */
  getDefaultTemplateTypes(): Array<{ type: string; label: string; description: string; variables: string[] }> {
    return [
      { 
        type: "inviteNewUser", 
        label: "Invite New User",
        description: "Template for inviting new users who do not have an account yet",
        variables: ["inviterName", "tenant", "inviteLink", "expirationDate"]
      },
      { 
        type: "inviteExistingUser", 
        label: "Invite Existing User",
        description: "Template for inviting existing users to a new tenant",
        variables: ["inviterName", "tenant", "inviteLink", "expirationDate"]
      },
      { 
        type: "magicLinkUrl", 
        label: "Magic Link (URL)",
        description: "Template for magic link URL authentication",
        variables: ["name", "magicLinkUrl", "project_name"]
      },
      { 
        type: "magicLinkCode", 
        label: "Magic Link (Code)",
        description: "Template for magic link code authentication",
        variables: ["name", "code", "project_name"]
      },
      { 
        type: "passwordReset", 
        label: "Password Reset",
        description: "Template for password reset emails",
        variables: ["name", "resetUrl", "expiresAt", "project_name"]
      },
      { 
        type: "emailVerification", 
        label: "Email Verification",
        description: "Template for email verification",
        variables: ["name", "verifyUrl", "project_name"]
      },
      { 
        type: "welcome", 
        label: "Welcome Email",
        description: "Template for welcome emails to new users",
        variables: ["name", "loginUrl", "project_name"]
      },
      { 
        type: "notification", 
        label: "Notification",
        description: "Generic notification template",
        variables: ["name", "notification_title", "notification_message", "action_url", "action_text"]
      }
    ];
  }

  /**
   * Get common variables available in all templates
   */
  getCommonVariables(): string[] {
    return [
      "project_name",
      "project_color", 
      "project_url",
      "app_url",
      "email_signature",
      "logo_url"
    ];
  }

  /**
   * Get or create tenant-specific transporter
   */
  async getTenantTransporter(tenantId: string | number): Promise<TenantTransporter | null> {
    if (!tenantId) {
      return null;
    }

    // Check cache first
    if (this.tenantTransporters.has(tenantId)) {
      return this.tenantTransporters.get(tenantId)!;
    }

    try {
      const smtpConfig = await settingsService.getTenantSMTPConfig(tenantId);

      if (!smtpConfig) {
        // No tenant-specific SMTP config, use default
        return null;
      }

      const transporter = nodemailer.createTransport({
        host: smtpConfig.host,
        port: smtpConfig.port,
        secure: smtpConfig.secure,
        auth: smtpConfig.auth,
      });

      const tenantTransporter: TenantTransporter = {
        transporter,
        from: smtpConfig.from,
        fromName: smtpConfig.fromName,
      };

      // Cache the transporter
      this.tenantTransporters.set(tenantId, tenantTransporter);

      console.info(`Created tenant-specific transporter for tenant: ${tenantId}`);
      return tenantTransporter;
    } catch (error) {
      console.error(`Error creating tenant transporter for ${tenantId}:`, error);
      return null;
    }
  }

  /**
   * Invalidate tenant transporter cache
   */
  invalidateTenantTransporter(tenantId?: string | number): void {
    if (tenantId) {
      this.tenantTransporters.delete(tenantId);
      console.info(`Tenant transporter cache invalidated for: ${tenantId}`);
    } else {
      // Clear all tenant transporters
      this.tenantTransporters.clear();
      console.info("All tenant transporter cache cleared");
    }
  }

  async sendMail(options: MailOptions): Promise<any> {
    const { to, subject, templateName, context, from, sender = this.defaultSender, attachments, tenantId } = options;

    let transporter: nodemailer.Transporter | null = null;
    let defaultFrom: string = "";
    let finalSender: string = "";

    // Try to use tenant-specific transporter first
    if (tenantId) {
      const tenantTransporter = await this.getTenantTransporter(tenantId);
      if (tenantTransporter) {
        transporter = tenantTransporter.transporter;
        defaultFrom = tenantTransporter.from;
        finalSender = `tenant-${tenantId}`;
        console.info(`Using tenant-specific SMTP for tenant: ${tenantId}`);
      }
    }

    // Fall back to global senders if no tenant-specific config
    if (!transporter) {
      if (!sender || !this.senders[sender]) {
        throw new Error(`Mail sender "${sender}" not configured.`);
      }
      const senderConfig = this.senders[sender];
      transporter = senderConfig.transporter;
      defaultFrom = senderConfig.from;
      finalSender = sender;
    }

    try {
      const customContext: Record<string, any> = {};
      let useTenantSettings = false;

      // Get tenant-specific branding if tenantId is provided
      if (tenantId) {
        try {
          const tenantBranding = await settingsService.getTenantEmailBranding(tenantId);

          customContext.email_signature = tenantBranding.email_signature;
          customContext.project_name = tenantBranding.project_name;
          customContext.project_color = tenantBranding.project_color;
          customContext.app_url = tenantBranding.app_url;
          customContext.project_url = tenantBranding.project_url;

          if (tenantBranding.logo_url) {
            customContext.logo_url = tenantBranding.logo_url;
          } else if (this.logoDataUri) {
            customContext.logo_url = this.logoDataUri;
          }
          useTenantSettings = true;
        } catch (error: any) {
          console.warn(`Error loading tenant branding for ${tenantId}, falling back to global settings:`, error.message);
        }
      }

      // Use global settings if no tenant-specific config
      if (!useTenantSettings) {
        const settings = settingsService.getSettings();
        if (settings?.email_signature) {
          customContext.email_signature = settings.email_signature;
        }

        if (settings?.project_name) {
          customContext.project_name = settings.project_name;
        }

        if (settings?.email_icon && settings?.project_url) {
          customContext.logo_url = settings.project_url + "/assets/email_icon";
        } else if (this.logoDataUri) {
          customContext.logo_url = this.logoDataUri;
        }

        if (settings?.project_color) {
          customContext.project_color = settings.project_color;
        }

        if (settings?.app_url) {
          customContext.app_url = settings.app_url;
        }

        if (settings?.project_url) {
          customContext.project_url = settings.project_url;
        }
      }

      // Try to get template from database (with tenant-specific override support)
      // Falls back to file-based templates if not found
      const rendered = await this.renderTemplateWithDB(templateName, { ...customContext, ...context, subject }, tenantId);
      const html = rendered.html;
      // Use the subject from database template if available, otherwise use the provided subject
      const finalSubject = rendered.subject || subject;

      const mailOptions: nodemailer.SendMailOptions = {
        from: from || defaultFrom,
        to,
        subject: finalSubject,
        html,
        attachments: attachments || [],
      };

      const info = await transporter.sendMail(mailOptions);
      console.log(`Message sent via ${finalSender}: ${info.messageId}`);

      // Log email sent event
      this.logEmail({
        email: to,
        subject,
        templateName,
        sender: finalSender,
        tenantId: tenantId || null,
        status: "sent",
        messageId: info.messageId,
      });

      return info;
    } catch (error: any) {
      console.error("Error sending email:", error);

      // Log email error event
      this.logEmail({
        email: to,
        subject,
        templateName,
        sender: finalSender || sender || '',
        tenantId: tenantId || null,
        status: "error",
        errorMessage: error.message,
      });

      throw error;
    }
  }

  /**
   * Log email to database asynchronously (fire and forget)
   */
  private logEmail(logData: {
    email: string;
    subject: string;
    templateName: string;
    sender: string;
    tenantId: string | number | null;
    status: string;
    messageId?: string;
    errorMessage?: string;
  }): void {
    // Import ItemsService dynamically to avoid circular dependency
    import('./ItemsService.js').then(({ default: ItemsService }) => {
      const emailLogService = new ItemsService('baasix_EmailLog', {
        accountability: undefined, // System operation, bypass permissions
      });

      emailLogService.createOne({
        email: logData.email,
        subject: logData.subject,
        templateName: logData.templateName,
        sender: logData.sender,
        status: logData.status,
        messageId: logData.messageId || null,
        errorMessage: logData.errorMessage || null,
      }, { bypassPermissions: true }).catch((error: any) => {
        console.error('Error logging email to database:', error.message);
      });
    }).catch((error: any) => {
      console.error('Error importing ItemsService for email logging:', error.message);
    });
  }
}

// Use globalThis to ensure singleton across different module loading paths
declare global {
  var __baasix_mailService: MailService | undefined;
}

// Create singleton instance only if it doesn't exist
if (!globalThis.__baasix_mailService) {
  globalThis.__baasix_mailService = new MailService();
}

const mailService = globalThis.__baasix_mailService;

export default mailService;

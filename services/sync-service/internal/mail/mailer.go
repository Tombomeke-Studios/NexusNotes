// Package mail sends transactional auth emails (#50). With SMTP configured
// it speaks plain net/smtp (STARTTLS via the default auth mechanism); without
// it, a log sink prints the message so development and mail-less self-hosts
// keep working — callers can check Enabled() to relax email-dependent rules.
package mail

import (
	"fmt"
	"log/slog"
	"net/smtp"
	"strings"
)

type Mailer interface {
	// Send delivers a plain-text message.
	Send(to, subject, body string) error
	// Enabled reports whether real delivery is configured.
	Enabled() bool
}

// SMTPConfig carries the SMTP_* environment settings.
type SMTPConfig struct {
	Host string
	Port int
	User string
	Pass string
	From string
}

// New returns an SMTP mailer when a host is configured, else the log sink.
func New(cfg SMTPConfig) Mailer {
	if cfg.Host == "" {
		return &logMailer{}
	}
	return &smtpMailer{cfg: cfg}
}

type smtpMailer struct {
	cfg SMTPConfig
}

func (m *smtpMailer) Enabled() bool { return true }

func (m *smtpMailer) Send(to, subject, body string) error {
	addr := fmt.Sprintf("%s:%d", m.cfg.Host, m.cfg.Port)
	var auth smtp.Auth
	if m.cfg.User != "" {
		auth = smtp.PlainAuth("", m.cfg.User, m.cfg.Pass, m.cfg.Host)
	}
	msg := strings.Join([]string{
		"From: " + m.cfg.From,
		"To: " + to,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		`Content-Type: text/plain; charset="utf-8"`,
		"",
		body,
	}, "\r\n")
	if err := smtp.SendMail(addr, auth, m.cfg.From, []string{to}, []byte(msg)); err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}

// logMailer prints instead of sending; the log line carries everything a
// developer needs (including the action link inside the body).
type logMailer struct{}

func (m *logMailer) Enabled() bool { return false }

func (m *logMailer) Send(to, subject, body string) error {
	slog.Info("mail (SMTP not configured, logging instead)", "to", to, "subject", subject, "body", body)
	return nil
}

package org.agro.ledger.service;

import jakarta.mail.internet.MimeMessage;
import java.time.LocalDate;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.client.StaffProfileClient;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;
import org.thymeleaf.TemplateEngine;
import org.thymeleaf.context.Context;

@Service
@RequiredArgsConstructor
public class MailService {

  private final JavaMailSender sender;
  private final TemplateEngine templates;
  private final StaffProfileClient staff;

  public void weekEscalated(String agronomistNumber, LocalDate weekStart) {
    StaffProfileClient.Profile agronomist = staff.profile(agronomistNumber);
    StaffProfileClient.Profile head = staff.profile(agronomist.headNumber());
    Context ctx = new Context();
    ctx.setVariable("headName", head.fullName());
    ctx.setVariable("agronomistName", agronomist.fullName());
    ctx.setVariable("weekStart", weekStart);
    send(head.email(), "Замеры переданы на подтверждение", templates.process("mail/week-escalated", ctx));
  }

  public void windowRequested(String agronomistNumber, LocalDate weekStart, String reason) {
    StaffProfileClient.Profile agronomist = staff.profile(agronomistNumber);
    StaffProfileClient.Profile head = staff.profile(agronomist.headNumber());
    Context ctx = new Context();
    ctx.setVariable("agronomistName", agronomist.fullName());
    ctx.setVariable("weekStart", weekStart);
    ctx.setVariable("reason", reason);
    send(head.email(), "Запрос на открытие недели", templates.process("mail/window-requested", ctx));
  }

  /** Письмо получает тот, кому передают шаблоны; методисты узнают о запросе из списка, не из почты. */
  public void handoverRequested(String fromHead, String toHead) {
    StaffProfileClient.Profile from = staff.profile(fromHead);
    StaffProfileClient.Profile to = staff.profile(toHead);
    Context ctx = new Context();
    ctx.setVariable("fromName", from.fullName());
    ctx.setVariable("toName", to.fullName());
    send(to.email(), "Вам передают шаблоны замеров", templates.process("mail/handover-requested", ctx));
  }

  private void send(String to, String subject, String html) {
    try {
      MimeMessage msg = sender.createMimeMessage();
      MimeMessageHelper h = new MimeMessageHelper(msg, "UTF-8");
      h.setTo(to);
      h.setSubject(subject);
      h.setText(html, true);
      sender.send(msg);
    } catch (Exception e) {
      throw new IllegalStateException("mail failed", e);
    }
  }
}

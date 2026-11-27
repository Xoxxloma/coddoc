package org.agro.ledger.jobs;

import java.time.DayOfWeek;
import java.time.LocalDate;
import java.time.temporal.TemporalAdjusters;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.agro.ledger.domain.EntryStatus;
import org.agro.ledger.domain.MeasurementEntry;
import org.agro.ledger.repository.MeasurementEntryRepository;
import org.agro.ledger.service.MailService;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class UnsubmittedWeeksJob {

  private final MeasurementEntryRepository entries;
  private final MailService mail;

  /** Понедельник утром: черновики прошлой недели уходят главному агроному сами. */
  @Scheduled(cron = "0 0 6 * * MON")
  @Transactional
  public void escalate() {
    LocalDate weekStart = LocalDate.now().minusWeeks(1).with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
    List<MeasurementEntry> drafts = entries.findByStatusAndEntryDateBetween(EntryStatus.DRAFT, weekStart, weekStart.plusDays(6));
    drafts.forEach(e -> e.setStatus(EntryStatus.PENDING));
    drafts.stream().map(MeasurementEntry::getAgronomistNumber).distinct()
        .forEach(n -> mail.weekEscalated(n, weekStart));
  }
}

package org.agro.ledger.jobs;

import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.agro.ledger.repository.MeasurementEntryRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class StaleDraftsPurgeJob {

  private final MeasurementEntryRepository entries;

  @Value("${ledger.drafts.retention-days}")
  private int retentionDays;

  @Scheduled(cron = "0 0 3 * * *")
  @SchedulerLock(name = "StaleDraftsPurgeJob_purge", lockAtMostFor = "PT5M")
  @Transactional
  public void purge() {
    entries.deleteDraftsUpdatedBefore(LocalDateTime.now().minusDays(retentionDays));
  }
}

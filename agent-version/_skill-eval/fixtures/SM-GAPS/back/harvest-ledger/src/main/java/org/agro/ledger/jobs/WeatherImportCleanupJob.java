package org.agro.ledger.jobs;

import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.agro.ledger.repository.WeatherImportRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class WeatherImportCleanupJob {

  private final WeatherImportRepository imports;

  @Value("${ledger.imports.failed-retention-days}")
  private int retentionDays;

  @Scheduled(cron = "0 30 2 * * SUN")
  @SchedulerLock(name = "WeatherImportCleanupJob_clean", lockAtMostFor = "PT10M")
  @Transactional
  public void clean() {
    imports.deleteFailedBefore(LocalDateTime.now().minusDays(retentionDays));
  }
}

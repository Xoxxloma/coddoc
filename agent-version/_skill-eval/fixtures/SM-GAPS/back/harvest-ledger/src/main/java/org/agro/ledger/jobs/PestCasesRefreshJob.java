package org.agro.ledger.jobs;

import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Slf4j
@Component
@RequiredArgsConstructor
public class PestCasesRefreshJob {

  private final JdbcTemplate jdbc;

  @Scheduled(cron = "0 */30 * * * *")
  @SchedulerLock(name = "PestCasesRefreshJob_refresh", lockAtMostFor = "PT2M", lockAtLeastFor = "PT30S")
  public void refresh() {
    try {
      jdbc.execute("refresh materialized view concurrently ledger.mv_pest_cases");
    } catch (Exception e) {
      log.error("pest cases view refresh failed", e);
    }
  }
}

package org.agro.ledger.jobs;

import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.agro.ledger.domain.HandoverStatus;
import org.agro.ledger.repository.HandoverRequestRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class HandoverExpiryJob {

  private final HandoverRequestRepository requests;

  @Value("${ledger.handover.expire-days}")
  private int expireDays;

  /** Запрос без решения дольше срока закрывается сам; шаблоны остаются у прежнего главного агронома. */
  @Scheduled(cron = "0 15 4 * * *")
  @SchedulerLock(name = "HandoverExpiryJob_expire", lockAtMostFor = "PT5M")
  @Transactional
  public void expire() {
    requests.findByStatusAndCreatedAtBefore(HandoverStatus.REQUESTED, LocalDateTime.now().minusDays(expireDays))
        .forEach(r -> r.setStatus(HandoverStatus.EXPIRED));
  }
}

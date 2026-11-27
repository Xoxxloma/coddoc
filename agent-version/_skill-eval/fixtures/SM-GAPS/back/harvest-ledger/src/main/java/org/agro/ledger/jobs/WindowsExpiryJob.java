package org.agro.ledger.jobs;

import java.time.LocalDateTime;
import lombok.RequiredArgsConstructor;
import net.javacrumbs.shedlock.spring.annotation.SchedulerLock;
import org.agro.ledger.domain.WindowStatus;
import org.agro.ledger.repository.WeekWindowRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
@RequiredArgsConstructor
public class WindowsExpiryJob {

  private final WeekWindowRepository windows;

  @Value("${ledger.windows.open-hours}")
  private int openHours;

  @Scheduled(cron = "0 0 * * * *")
  @SchedulerLock(name = "WindowsExpiryJob_expire", lockAtMostFor = "PT5M")
  @Transactional
  public void expire() {
    windows.findByStatusAndOpenedAtBefore(WindowStatus.OPEN, LocalDateTime.now().minusHours(openHours))
        .forEach(w -> w.setStatus(WindowStatus.EXPIRED));
  }
}

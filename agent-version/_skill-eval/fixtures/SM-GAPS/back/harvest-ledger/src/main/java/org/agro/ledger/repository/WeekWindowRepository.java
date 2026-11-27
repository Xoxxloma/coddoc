package org.agro.ledger.repository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import org.agro.ledger.domain.WeekWindow;
import org.agro.ledger.domain.WindowStatus;
import org.springframework.data.jpa.repository.JpaRepository;

public interface WeekWindowRepository extends JpaRepository<WeekWindow, Long> {
  Optional<WeekWindow> findByAgronomistNumberAndWeekStart(String number, LocalDate weekStart);

  List<WeekWindow> findByAgronomistNumberOrderByWeekStartDesc(String number);

  List<WeekWindow> findByStatusOrderByWeekStart(WindowStatus status);

  List<WeekWindow> findByStatusAndOpenedAtBefore(WindowStatus status, LocalDateTime before);
}

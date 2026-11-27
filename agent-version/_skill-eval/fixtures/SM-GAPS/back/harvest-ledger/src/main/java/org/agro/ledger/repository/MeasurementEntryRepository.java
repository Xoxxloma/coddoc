package org.agro.ledger.repository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import org.agro.ledger.domain.EntryStatus;
import org.agro.ledger.domain.MeasurementEntry;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;

public interface MeasurementEntryRepository extends JpaRepository<MeasurementEntry, Long> {

  List<MeasurementEntry> findByAgronomistNumberAndEntryDateBetweenOrderByEntryDate(String number, LocalDate from, LocalDate to);

  List<MeasurementEntry> findByAgronomistNumberAndEntryDate(String number, LocalDate date);

  List<MeasurementEntry> findByStatusAndEntryDateBetween(EntryStatus status, LocalDate from, LocalDate to);

  long countByEntryDateBetweenAndStatusIn(LocalDate from, LocalDate to, List<EntryStatus> statuses);

  @Modifying
  @Query("delete from MeasurementEntry e where e.status = org.agro.ledger.domain.EntryStatus.DRAFT and e.updatedAt < :before")
  int deleteDraftsUpdatedBefore(LocalDateTime before);
}

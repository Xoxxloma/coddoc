package org.agro.ledger.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Entity
@Table(name = "weather_import", schema = "ledger")
public class WeatherImport {
  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(name = "file_name", nullable = false)
  private String fileName;

  @Column(name = "rows_loaded", nullable = false)
  private int rowsLoaded;

  /** OK | FAILED */
  @Column(nullable = false)
  private String status;

  private String error;

  @Column(name = "loaded_by", nullable = false)
  private String loadedBy;

  @Column(name = "loaded_at", nullable = false)
  private LocalDateTime loadedAt = LocalDateTime.now();
}
